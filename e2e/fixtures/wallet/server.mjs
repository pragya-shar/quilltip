/* global Bun */
// Run explicitly with Bun. Wallet fixture server; it never ships as an app route.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = path.resolve(import.meta.dirname, '../../..')
const runtime = path.join(import.meta.dirname, 'runtime.ts')
// `?wc=1` serves a second build with WalletConnect on: a project ID that only
// has the right format, and a fake sign client instead of the real one.
const FORMAT_ONLY_PROJECT_ID = '0123456789abcdef0123456789abcdef'
const build = (walletConnect) =>
  Bun.build({
    entrypoints: [path.join(import.meta.dirname, 'page.tsx')],
    target: 'browser',
    define: {
      'process.env.NODE_ENV': '"development"',
      ...(walletConnect
        ? {
            'process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID': JSON.stringify(
              FORMAT_ONLY_PROJECT_ID
            ),
          }
        : {}),
      'process.env': '{}',
    },
    plugins: [
      {
        name: 'isolated-wallet-collaborators',
        setup(build) {
          // Fonts are served by this server from public/, not bundled.
          build.onResolve(
            { filter: /^\/(landing|account)\/fonts\// },
            (args) => ({
              path: args.path,
              external: true,
            })
          )
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: path.join(import.meta.dirname, 'navigation.ts'),
          }))
          build.onResolve({ filter: /^next\/link$/ }, () => ({
            path: path.join(import.meta.dirname, '../nft/link.tsx'),
          }))
          build.onResolve(
            {
              filter:
                /^(convex\/react|next\/dynamic|@\/(convex\/_generated\/api|components\/providers\/AuthContext|lib\/stellar\/client))$/,
            },
            () => ({ path: runtime })
          )
          build.onResolve({ filter: /^@walletconnect\/sign-client$/ }, () => ({
            path: path.join(import.meta.dirname, 'fake-sign-client.ts'),
          }))
        },
      },
    ],
  })
const [result, resultWc] = await Promise.all([build(false), build(true)])
if (!result.success) throw new AggregateError(result.logs)
if (!resultWc.success) throw new AggregateError(resultWc.logs)
// The stand-in for xBull's web wallet; the spec serves it in xBull's window.
const xbullWeb = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'xbull-web.ts')],
  target: 'browser',
})
if (!xbullWeb.success) throw new AggregateError(xbullWeb.logs)
const xbullWebJs = await xbullWeb.outputs[0].text()
const css = await postcss([tailwind({ base: root })]).process(
  "@import './app/globals.css';",
  { from: path.join(root, 'wallet-fixture.css') }
)
const read = async (built, prefix) =>
  new Map(
    await Promise.all(
      built.outputs.map(async (output) => [
        prefix + path.basename(output.path),
        await output.text(),
      ])
    )
  )
const outputs = new Map([
  ...(await read(result, '')),
  ...(await read(resultWc, 'wc-')),
])
const jsName = [...outputs.keys()].find(
  (name) => !name.startsWith('wc-') && name.endsWith('.js')
)
const cssName = [...outputs.keys()].find(
  (name) => !name.startsWith('wc-') && name.endsWith('.css')
)
const wcJsName = [...outputs.keys()].find(
  (name) => name.startsWith('wc-') && name.endsWith('.js')
)
// `WALLET_FIXTURE_PORT` moves the server off 4177 when another run uses it.
const port = Number(process.env.WALLET_FIXTURE_PORT ?? 4177)
Bun.serve({
  hostname: '127.0.0.1',
  port,
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
    if (url.pathname === '/fake/xbull-web.js')
      return new Response(xbullWebJs, {
        headers: { 'Content-Type': 'text/javascript' },
      })
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
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/${cssName}"></head><body><div id="root"></div><script type="module" src="/${url.searchParams.get('wc') === '1' ? wcJsName : jsName}"></script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  },
})
console.log(`Wallet fixtures: http://127.0.0.1:${port}`)
