/* global Bun */
// Run explicitly with Bun. Today fixture server (port 4188); it never ships
// as an app route. Today's real components in the real application shell,
// rendered to HTML on the server and hydrated in the browser (as Next.js
// does), with next/link and next/navigation replaced by plain stand-ins and
// a fake for auth and drafts. No backend, no secrets.
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile } from 'node:fs/promises'

const PORT = Number(process.env.TODAY_FIXTURE_PORT ?? 4188)
const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const plugins = [
  {
    name: 'today-collaborators',
    setup(build) {
      build.onResolve({ filter: /^\/fonts\// }, (args) => ({
        path: args.path,
        external: true,
      }))
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({
        path: path.join(here, 'navigation.ts'),
      }))
      build.onResolve({ filter: /^next\/link$/ }, () => ({
        path: path.join(root, 'e2e/fixtures/system/link.tsx'),
      }))
    },
  },
]
const define = { 'process.env.NODE_ENV': '"production"' }

const out = await mkdtemp(path.join(os.tmpdir(), 'today-fixture-'))
const server = await Bun.build({
  entrypoints: [path.join(here, 'render.tsx')],
  target: 'bun',
  outdir: path.join(out, 'server'),
  define,
  plugins,
})
if (!server.success) throw new AggregateError(server.logs)
const { render } = await import(
  server.outputs.find((o) => o.path.endsWith('.js')).path
)

const client = await Bun.build({
  entrypoints: [path.join(here, 'client.tsx')],
  target: 'browser',
  define: { ...define, 'process.env': '{}' },
  plugins,
})
if (!client.success) throw new AggregateError(client.logs)
const outputs = new Map(
  await Promise.all(
    client.outputs.map(async (o) => [path.basename(o.path), await o.text()])
  )
)
const jsName = [...outputs.keys()].find((n) => n.endsWith('.js'))
const cssName = [...outputs.keys()].find((n) => n.endsWith('.css'))

const page = (search) => {
  const { html } = render(search)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"><title>Quilltip</title><link rel="stylesheet" href="/${cssName}"></head><body><div id="root">${html}</div><script type="module" src="/${jsName}"></script></body></html>`
}

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/fonts/'))
      return new Response(
        await readFile(
          path.join(root, 'system/fonts', path.basename(url.pathname))
        ),
        { headers: { 'Content-Type': 'font/woff2' } }
      )
    const output = outputs.get(url.pathname.slice(1))
    if (output)
      return new Response(output, {
        headers: {
          'Content-Type': url.pathname.endsWith('.css')
            ? 'text/css'
            : 'text/javascript',
        },
      })
    // Every other path is Today (the article links lead nowhere here).
    return new Response(page(url.search), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  },
})
console.log(`Today fixture on http://127.0.0.1:${PORT}`)
