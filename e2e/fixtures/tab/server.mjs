/* global Bun */
// Run explicitly with Bun. Tab session-key fixture server; it never ships as
// an app route. It sends the app's production content security policy, so
// the suite also checks that the tab modules run without inline script,
// 'unsafe-eval' or WebAssembly.
import path from 'node:path'

import {
  buildContentSecurityPolicy,
  createNonce,
} from '../../../lib/security/contentSecurityPolicy.ts'

const PORT = 4181
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'page.ts')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
})
if (!result.success) throw new AggregateError(result.logs)
const outputs = new Map(
  await Promise.all(
    result.outputs.map(async (output) => [
      path.basename(output.path),
      await output.text(),
    ])
  )
)
const jsName = [...outputs.keys()].find((name) => name.endsWith('.js'))

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)
    const output = outputs.get(url.pathname.slice(1))
    if (output)
      return new Response(output, {
        headers: { 'Content-Type': 'text/javascript' },
      })
    if (url.pathname !== '/') return new Response('Not found', { status: 404 })
    const nonce = createNonce()
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title>Tab keys fixture</title></head><body><p id="status">loading</p><script type="module" nonce="${nonce}" src="/${jsName}"></script></body></html>`,
      {
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy': buildContentSecurityPolicy(nonce, {}),
        },
      }
    )
  },
})
console.log(`Tab key fixtures: http://127.0.0.1:${PORT}`)
