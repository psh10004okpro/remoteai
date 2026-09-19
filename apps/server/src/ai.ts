import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Capture the current remote desktop screen.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click at normalized coordinates 0-1 on the selected display.',
      parameters: {
        type: 'object',
        properties: {
          nx: { type: 'number' },
          ny: { type: 'number' },
          button: { type: 'string', enum: ['left', 'right', 'middle'] },
        },
        required: ['nx', 'ny'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type unicode text at the current cursor (IME-safe).',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'key',
      description: 'Press a key combination using KeyboardEvent.code names, e.g. ControlLeft+KeyS or Enter.',
      parameters: {
        type: 'object',
        properties: { combo: { type: 'string' } },
        required: ['combo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run',
      description: 'Run a shell command as the logged-in user. Only works if the host enabled REMOTEAI_AI_SHELL=1.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_path',
      description: 'Open a file, folder, or URL on the remote PC.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List a directory on the remote PC.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_windows',
      description: 'List visible window titles.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clipboard_get',
      description: 'Read the remote clipboard text or file names.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clipboard_set',
      description: 'Set remote clipboard text (same as session clipboard.text).',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
]

const SYSTEM = `You are RemoteAI, an assistant that controls a Windows PC over an authenticated remote-desktop session.
The user is the machine owner. Prefer screenshot then click/type for GUI apps. Use clipboard_get/clipboard_set for clipboard. Use run only if the host allows shell.
Coordinates nx, ny are 0-1 relative to the selected monitor. Be concise in Korean if the user writes Korean.
Never refuse ordinary desktop tasks (open apps, files, settings) on this owned machine.`

export type ToolBridge = {
  call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text?: string; imageJpegBase64?: string }>
  status(text: string): void
}

export async function runAiTurn(userText: string, history: ChatCompletionMessageParam[], bridge: ToolBridge) {
  const key = process.env.XAI_API_KEY
  if (!key) {
    return 'XAI_API_KEY 가 없습니다. 서버 `.env` 에 키를 넣으면 채팅으로 이 컴퓨터를 조작할 수 있습니다.'
  }
  const client = new OpenAI({ apiKey: key, baseURL: 'https://api.x.ai/v1' })
  const model = process.env.XAI_MODEL || 'grok-4.6'
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM },
    ...history.slice(-20),
    { role: 'user', content: userText },
  ]

  for (let i = 0; i < 8; i++) {
    bridge.status(i === 0 ? '생각 중…' : '도구 실행 후 다시 생각 중…')
    const resp = await client.chat.completions.create({
      model,
      messages,
      tools: TOOLS,
      temperature: 0.3,
    })
    const choice = resp.choices[0]
    const msg = choice.message
    messages.push(msg)
    const calls = msg.tool_calls
    if (!calls || calls.length === 0) {
      return (msg.content || '').trim() || '(빈 응답)'
    }
    for (const call of calls) {
      if (call.type !== 'function') continue
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        args = {}
      }
      bridge.status(`실행: ${call.function.name}`)
      const result = await bridge.call(call.function.name, args)
      const parts: ChatCompletionMessageParam = {
        role: 'tool',
        tool_call_id: call.id,
        content: result.imageJpegBase64
          ? JSON.stringify({ ok: result.ok, text: result.text || 'screenshot attached as jpeg base64 omitted in tool text', hasImage: true })
          : JSON.stringify({ ok: result.ok, text: result.text }),
      }
      messages.push(parts)
      if (result.imageJpegBase64) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: `Tool ${call.function.name} screenshot:` },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${result.imageJpegBase64}` } },
          ],
        })
      }
    }
  }
  return '작업이 길어져 여기서 멈췄습니다. 이어서 말씀해 주세요.'
}
