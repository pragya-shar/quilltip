/* global Bun */
// Run explicitly with Bun. Balance fixture server (port 4184); it never ships
// as an app route. It bundles the real payments provider, hooks and screens
// with a stand-in backend, Convex hooks and signer (see page.tsx).
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const PORT = Number(process.env.BALANCE_FIXTURE_PORT ?? 4184)
const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const result = await Bun.build({
  entrypoints: [path.join(here, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [
    {
      name: 'balance-collaborators',
      setup(build) {
        build.onResolve({ filter: /^\/landing\/fonts\// }, (args) => ({
          path: args.path,
          external: true,
        }))
        build.onResolve({ filter: /^convex\/react$/ }, () => ({
          path: path.join(here, 'convex-react.ts'),
        }))
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: path.join(here, 'navigation.ts'),
        }))
        // The old dashboard's section row (screen=account) links with it.
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: path.join(root, 'e2e/fixtures/system/link.tsx'),
        }))
        // The shell loads the engine through a wrapper that can delay it.
        build.onResolve({ filter: /^\.\/PaymentsEngine$/ }, (args) =>
          args.importer.endsWith('PaymentsShell.tsx')
            ? { path: path.join(here, 'engine.tsx') }
            : undefined
        )
        build.onResolve({ filter: /^@\/lib\/payments\/live\/signer$/ }, () => ({
          path: path.join(here, 'signer.ts'),
        }))
      },
    },
  ],
})
if (!result.success) throw new AggregateError(result.logs)
const css = await postcss([tailwind({ base: root })]).process(
  "@import './app/globals.css';",
  { from: path.join(root, 'balance-fixture.css') }
)
const outputs = new Map(
  await Promise.all(
    result.outputs.map(async (o) => [path.basename(o.path), await o.text()])
  )
)
const jsName = [...outputs.keys()].find((n) => n.endsWith('.js'))
const cssName = [...outputs.keys()].find((n) => n.endsWith('.css'))

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/landing/fonts/'))
      return new Response(
        await readFile(path.join(root, 'public', url.pathname)),
        { headers: { 'Content-Type': 'font/woff2' } }
      )
    if (url.pathname === '/base.css')
      return new Response(css.css, { headers: { 'Content-Type': 'text/css' } })
    const output = outputs.get(url.pathname.slice(1))
    if (output)
      return new Response(output, {
        headers: {
          'Content-Type': url.pathname.endsWith('.css')
            ? 'text/css'
            : 'text/javascript',
        },
      })
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Balance fixtures</title><link rel="stylesheet" href="/base.css">${cssName ? `<link rel="stylesheet" href="/${cssName}">` : ''}</head><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="/${jsName}"></script></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  },
})
console.log(`Balance fixtures: http://127.0.0.1:${PORT}`)
