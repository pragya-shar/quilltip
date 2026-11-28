/* global Bun */
// Run explicitly with Bun. passage selection fixture server (#665); it never ships as an app route.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = path.resolve(import.meta.dirname, '../../..')
const runtime = path.join(import.meta.dirname, 'runtime.ts')
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [
    {
      name: 'isolated-passage-touch-collaborators',
      setup(build) {
        // Fonts are served by this server from public/, not bundled.
        build.onResolve(
          { filter: /^\/(landing|account|prototype\/writing)\/fonts\// },
          (args) => ({
            path: args.path,
            external: true,
          })
        )
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: path.join(import.meta.dirname, '../wallet/navigation.ts'),
        }))
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: path.join(import.meta.dirname, '../nft/link.tsx'),
        }))
        build.onResolve(
          {
            filter:
              /^(convex\/react|next\/dynamic|@\/(convex\/_generated\/api|components\/providers\/AuthContext|lib\/stellar\/v2\/chain-runtime))$/,
          },
          () => ({ path: runtime })
        )
      },
    },
  ],
})
if (!result.success) throw new AggregateError(result.logs)
const css = await postcss([tailwind({ base: root })]).process(
  "@import './app/globals.css';",
  { from: path.join(root, 'passage-touch-fixture.css') }
)
const outputs = new Map(
  await Promise.all(
    result.outputs.map(async (output) => [
      path.basename(output.path),
      await output.text(),
    ])
  )
)
const jsName = [...outputs.keys()].find((name) => name.endsWith('.js'))
const cssName = [...outputs.keys()].find((name) => name.endsWith('.css'))
Bun.serve({
  hostname: '127.0.0.1',
  port: 4192,
  async fetch(request) {
    const url = new URL(request.url)
    if (
      url.pathname.startsWith('/landing/fonts/') ||
      url.pathname.startsWith('/account/fonts/') ||
      url.pathname.startsWith('/prototype/writing/fonts/')
    )
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
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Passage selection fixture</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/${cssName}"></head><body><div id="root"></div><script type="module" src="/${jsName}"></script></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  },
})
console.log('passage selection fixture: http://127.0.0.1:4192')
