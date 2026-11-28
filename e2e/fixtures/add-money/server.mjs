/* global Bun */
// Run explicitly with Bun. The Add money fixture server (port 4212, or
// ADD_MONEY_FIXTURE_PORT); it never ships as an app route. It bundles the
// Add money, quick tips and turn off sheets inside the real application
// shell, with next/link and next/navigation replaced by the system
// fixture's plain stand-ins, on an emulated wallet and network
// (./emulated.ts). No backend, no network, no secrets.
import path from 'node:path'
import { readFile } from 'node:fs/promises'

const PORT = Number(process.env.ADD_MONEY_FIXTURE_PORT ?? 4212)
const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const system = path.join(root, 'e2e/fixtures/system')
const result = await Bun.build({
  entrypoints: [path.join(here, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [
    {
      name: 'add-money-collaborators',
      setup(build) {
        build.onResolve({ filter: /^\/fonts\// }, (args) => ({
          path: args.path,
          external: true,
        }))
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: path.join(system, 'navigation.ts'),
        }))
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: path.join(system, 'link.tsx'),
        }))
      },
    },
  ],
})
if (!result.success) throw new AggregateError(result.logs)
const outputs = new Map(
  await Promise.all(
    result.outputs.map(async (o) => [path.basename(o.path), await o.text()])
  )
)
const jsName = [...outputs.keys()].find((n) => n.endsWith('.js'))
const cssName = [...outputs.keys()].find((n) => n.endsWith('.css'))

const html = (title, body = '<div id="root"></div>', script = true) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"><title>${title}</title><link rel="stylesheet" href="/${cssName}"></head><body>${body}${script ? `<script type="module" src="/${jsName}"></script>` : ''}</body></html>`

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
    if (['/', '/balance'].includes(url.pathname))
      return new Response(html('Quilltip Add money fixture'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    return new Response('Not found', { status: 404 })
  },
})
console.log(`Add money fixtures: http://127.0.0.1:${PORT}`)
