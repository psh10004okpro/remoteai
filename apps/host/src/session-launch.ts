import { spawn } from 'node:child_process'
import koffi from 'koffi'
import { log } from './log.js'

const kernel32 = koffi.load('kernel32.dll')
const advapi32 = koffi.load('advapi32.dll')
const wtsapi32 = koffi.load('wtsapi32.dll')
const userenv = koffi.load('userenv.dll')

const STARTUPINFOW = koffi.struct('STARTUPINFOW', {
  cb: 'uint32',
  lpReserved: 'void *',
  lpDesktop: 'str16',
  lpTitle: 'str16',
  dwX: 'uint32',
  dwY: 'uint32',
  dwXSize: 'uint32',
  dwYSize: 'uint32',
  dwXCountChars: 'uint32',
  dwYCountChars: 'uint32',
  dwFillAttribute: 'uint32',
  dwFlags: 'uint32',
  wShowWindow: 'uint16',
  cbReserved2: 'uint16',
  lpReserved2: 'void *',
  hStdInput: 'void *',
  hStdOutput: 'void *',
  hStdError: 'void *',
})

const PROCESS_INFORMATION = koffi.struct('PROCESS_INFORMATION', {
  hProcess: 'void *',
  hThread: 'void *',
  dwProcessId: 'uint32',
  dwThreadId: 'uint32',
})

const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
  dwSize: 'uint32',
  cntUsage: 'uint32',
  th32ProcessID: 'uint32',
  th32DefaultHeapID: 'uintptr',
  th32ModuleID: 'uint32',
  cntThreads: 'uint32',
  th32ParentProcessID: 'uint32',
  pcPriClassBase: 'int32',
  dwFlags: 'uint32',
  szExeFile: koffi.array('uint16', 260),
})

const GetCurrentProcessId = kernel32.func('uint32 __stdcall GetCurrentProcessId()')
const ProcessIdToSessionId = kernel32.func('bool __stdcall ProcessIdToSessionId(uint32, _Out_ uint32 *)')
const WTSGetActiveConsoleSessionId = kernel32.func('uint32 __stdcall WTSGetActiveConsoleSessionId()')
const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32, bool, uint32)')
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *)')
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()')
const CreateToolhelp32Snapshot = kernel32.func('void * __stdcall CreateToolhelp32Snapshot(uint32, uint32)')
const Process32FirstW = kernel32.func('bool __stdcall Process32FirstW(void *, PROCESSENTRY32W *)')
const Process32NextW = kernel32.func('bool __stdcall Process32NextW(void *, PROCESSENTRY32W *)')

const WTSQueryUserToken = wtsapi32.func('bool __stdcall WTSQueryUserToken(uint32, _Out_ void **)')
const OpenProcessToken = advapi32.func('bool __stdcall OpenProcessToken(void *, uint32, _Out_ void **)')
const DuplicateTokenEx = advapi32.func('bool __stdcall DuplicateTokenEx(void *, uint32, void *, int, int, _Out_ void **)')
const CreateProcessAsUserW = advapi32.func(
  'bool __stdcall CreateProcessAsUserW(void *hToken, str16 lpApplicationName, str16 lpCommandLine, void *lpProcessAttributes, void *lpThreadAttributes, bool bInheritHandles, uint32 dwCreationFlags, void *lpEnvironment, str16 lpCurrentDirectory, STARTUPINFOW *lpStartupInfo, _Out_ PROCESS_INFORMATION *lpProcessInformation)',
)
const CreateEnvironmentBlock = userenv.func('bool __stdcall CreateEnvironmentBlock(_Out_ void **, void *, bool)')
const DestroyEnvironmentBlock = userenv.func('bool __stdcall DestroyEnvironmentBlock(void *)')

const TH32CS_SNAPPROCESS = 0x00000002
const PROCESS_QUERY_INFORMATION = 0x0400
const TOKEN_DUPLICATE = 0x0002
const TOKEN_QUERY = 0x0008
const TOKEN_ASSIGN_PRIMARY = 0x0001
const TOKEN_ADJUST_DEFAULT = 0x0080
const TOKEN_ADJUST_SESSIONID = 0x0100
const TOKEN_FLAGS =
  TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID
const SecurityImpersonation = 2
const TokenPrimary = 1
const CREATE_UNICODE_ENVIRONMENT = 0x00000400
const CREATE_NEW_PROCESS_GROUP = 0x00000200
const STARTF_USESHOWWINDOW = 0x00000001
const SW_HIDE = 0
const INVALID = koffi.NULL ? koffi.NULL : null

export function currentSessionId() {
  const out = [0]
  if (!ProcessIdToSessionId(GetCurrentProcessId(), out)) return -1
  return out[0] as number
}

export function activeConsoleSessionId() {
  return WTSGetActiveConsoleSessionId() as number
}

function exeName(entry: { szExeFile: number[] }) {
  const chars = entry.szExeFile || []
  let s = ''
  for (const c of chars) {
    if (!c) break
    s += String.fromCharCode(c)
  }
  return s
}

function winlogonPid(sessionId: number) {
  const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
  if (!snap || snap === INVALID) return 0
  const pe = {
    dwSize: koffi.sizeof(PROCESSENTRY32W),
    cntUsage: 0,
    th32ProcessID: 0,
    th32DefaultHeapID: 0,
    th32ModuleID: 0,
    cntThreads: 0,
    th32ParentProcessID: 0,
    pcPriClassBase: 0,
    dwFlags: 0,
    szExeFile: new Array(260).fill(0),
  }
  let pid = 0
  try {
    if (!Process32FirstW(snap, pe)) return 0
    for (;;) {
      if (exeName(pe).toLowerCase() === 'winlogon.exe') {
        const sid = [0]
        if (ProcessIdToSessionId(pe.th32ProcessID, sid) && sid[0] === sessionId) {
          pid = pe.th32ProcessID
          break
        }
      }
      if (!Process32NextW(snap, pe)) break
    }
  } finally {
    CloseHandle(snap)
  }
  return pid
}

function tokenForSession(sessionId: number): { token: unknown; desktop: string } | null {
  const userTok: unknown[] = [null]
  if (WTSQueryUserToken(sessionId, userTok) && userTok[0]) {
    return { token: userTok[0], desktop: 'winsta0\\Default' }
  }
  const pid = winlogonPid(sessionId)
  if (!pid) {
    log('session token: no winlogon', sessionId, 'err', GetLastError())
    return null
  }
  const proc = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid)
  if (!proc) {
    log('session OpenProcess winlogon', GetLastError())
    return null
  }
  try {
    const tok: unknown[] = [null]
    if (!OpenProcessToken(proc, TOKEN_FLAGS, tok) || !tok[0]) {
      log('session OpenProcessToken', GetLastError())
      return null
    }
    const dup: unknown[] = [null]
    if (!DuplicateTokenEx(tok[0], TOKEN_FLAGS, null, SecurityImpersonation, TokenPrimary, dup) || !dup[0]) {
      log('session DuplicateTokenEx', GetLastError())
      CloseHandle(tok[0])
      return null
    }
    CloseHandle(tok[0])
    return { token: dup[0], desktop: 'winsta0\\Winlogon' }
  } finally {
    CloseHandle(proc)
  }
}

export function launchInSession(opts: { sessionId: number; exe: string; args: string[]; cwd: string }) {
  try {
    const got = tokenForSession(opts.sessionId)
    if (!got) return 0
    const env: unknown[] = [null]
    CreateEnvironmentBlock(env, got.token, false)
    const si = {
      cb: koffi.sizeof(STARTUPINFOW),
      lpReserved: null,
      lpDesktop: got.desktop,
      lpTitle: null,
      dwX: 0,
      dwY: 0,
      dwXSize: 0,
      dwYSize: 0,
      dwXCountChars: 0,
      dwYCountChars: 0,
      dwFillAttribute: 0,
      dwFlags: STARTF_USESHOWWINDOW,
      wShowWindow: SW_HIDE,
      cbReserved2: 0,
      lpReserved2: null,
      hStdInput: null,
      hStdOutput: null,
      hStdError: null,
    }
    const pi = {
      hProcess: null,
      hThread: null,
      dwProcessId: 0,
      dwThreadId: 0,
    }
    const quoted = [opts.exe, ...opts.args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')
    const ok = CreateProcessAsUserW(
      got.token,
      opts.exe,
      quoted,
      null,
      null,
      false,
      CREATE_UNICODE_ENVIRONMENT | CREATE_NEW_PROCESS_GROUP,
      env[0] || null,
      opts.cwd,
      si,
      pi,
    )
    if (env[0]) DestroyEnvironmentBlock(env[0])
    CloseHandle(got.token)
    if (!ok) {
      log('CreateProcessAsUser failed', GetLastError(), 'desktop', got.desktop, 'session', opts.sessionId)
      return 0
    }
    if (pi.hThread) CloseHandle(pi.hThread)
    if (pi.hProcess) CloseHandle(pi.hProcess)
    log('launched session helper', pi.dwProcessId, 'session', opts.sessionId, got.desktop)
    return pi.dwProcessId as number
  } catch (e) {
    log('launchInSession', e)
    return 0
  }
}

function alive(pid: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function watchInteractiveSession() {
  const sid0 = currentSessionId()
  log('service watchdog session', sid0)
  const exe = process.execPath
  const entry = process.argv[1]
  const cwd = process.env.REMOTEAI_HOME || process.cwd()
  const args = [entry, '--session', '--silent']
  let child = 0
  let lastSid = -1
  const tick = () => {
    try {
      const sid = activeConsoleSessionId()
      if (sid === 0xffffffff) return
      if (child && alive(child) && sid === lastSid) return
      if (child && alive(child)) {
        try {
          process.kill(child)
        } catch {
          /* ignore */
        }
        spawn('taskkill', ['/PID', String(child), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        child = 0
      }
      lastSid = sid
      child = launchInSession({ sessionId: sid, exe, args, cwd })
    } catch (e) {
      log('session tick', e)
      child = 0
    }
  }
  tick()
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500))
    tick()
  }
}
