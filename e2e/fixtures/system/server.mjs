/* global Bun */
// Run explicitly with Bun. Design system fixture server (port 4185); it never
// ships as an app route. It bundles the gallery and the sample reading page
// inside the real application shell, with next/link and next/navigation
// replaced by plain stand-ins. No backend, no secrets.
import path from 'node:path'
import { readFile } from 'node:fs/promises'

const PORT = Number(process.env.SYSTEM_FIXTURE_PORT ?? 4185)
const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const result = await Bun.build({
  entrypoints: [path.join(here, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [
    {
      name: 'system-collaborators',
      setup(build) {
        build.onResolve({ filter: /^\/fonts\// }, (args) => ({
          path: args.path,
          external: true,
        }))
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: path.join(here, 'navigation.ts'),
        }))
        // The today package's sheet declarations, replaced by demo sheets.
        build.onResolve({ filter: /^\.\/today$/ }, (args) =>
          args.importer.endsWith(path.join('shell', 'sheets', 'index.ts'))
            ? { path: path.join(here, 'demoSheets.ts') }
            : undefined
        )
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: path.join(here, 'link.tsx'),
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

const html = (title) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"><title>${title}</title><link rel="stylesheet" href="/${cssName}"></head><body><div id="root"></div><script type="module" src="/${jsName}"></script></body></html>`

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
    if (
      ['/', '/reading', '/shelf', '/pocket', '/sheets'].includes(url.pathname)
    )
      return new Response(html('Quilltip system fixture'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    return new Response('Not found', { status: 404 })
  },
})
console.log(`Design system fixtures: http://127.0.0.1:${PORT}`)
