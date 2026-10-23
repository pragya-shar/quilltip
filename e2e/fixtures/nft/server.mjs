/* global Bun */
// Run explicitly with Bun. This fixture server never ships as an app route.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = path.resolve(import.meta.dirname, '../../..')
const runtime = path.join(import.meta.dirname, 'runtime.ts')
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'isolated-nft-collaborators',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(convex\/react|@\/(hooks\/convex|convex\/_generated\/api|components\/providers\/(WalletProvider|WalletActivationContext)|components\/stellar\/InstallWalletDialog|lib\/stellar\/(nft-client|client|wallet-adapter)))$/,
          },
          () => ({ path: runtime })
        )
      },
    },
  ],
})
if (!result.success) throw new AggregateError(result.logs)
const css = await postcss([tailwind({ base: root })]).process(
  "@import 'tailwindcss';\n@import './app/shared-ui.css';\n@import './components/articles/reader.css';",
  { from: path.join(root, 'nft-fixture.css') }
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
  port: 4174,
  async fetch(request) {
    const url = new URL(request.url)
    if (
      url.pathname.startsWith('/landing/fonts/') ||
      url.pathname.startsWith('/account/fonts/')
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
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/${cssName}"></head><body><div id="root"></div><script type="module" src="/${jsName}"></script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  },
})
console.log('NFT fixtures: http://127.0.0.1:4174')
