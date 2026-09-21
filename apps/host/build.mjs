import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: {
    js: "import { createRequire as __remoteaiCreateRequire } from 'node:module'; const require = __remoteaiCreateRequire(import.meta.url);",
  },
  external: ['koffi', 'node-screenshots', 'sharp', 'node-pty', 'systray2', 'ssh2', 'ws'],
})
