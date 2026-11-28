/* global Bun */
// Run explicitly with Bun. Article image fixture (#615); it never ships as an
// app route. Serves the server HTML of one article under the app's own page
// policy, then the readers and the writing editor once scripts load. A second
// port stands in for this deployment's Convex storage.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const { OWN_ORIGIN, PAGE_PORT, STORAGE_PORT, article } =
  await import('./article.ts')
// The renderers and the page policy read this, as in the app.
process.env.NEXT_PUBLIC_CONVEX_URL = OWN_ORIGIN
const { renderArticleHtml } =
  await import('../../../lib/tiptap/renderArticleHtml.ts')
const { buildContentSecurityPolicy, createNonce } =
  await import('../../../lib/security/contentSecurityPolicy.ts')

const root = path.resolve(import.meta.dirname, '../../..')
const runtime = path.join(import.meta.dirname, 'runtime.ts')
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'page.tsx')],
  target: 'browser',
  define: {
    'process.env.NODE_ENV': '"development"',
    'process.env.NEXT_PUBLIC_CONVEX_URL': JSON.stringify(OWN_ORIGIN),
    'process.env': '{}',
  },
  plugins: [
    {
      name: 'isolated-article-image-collaborators',
      setup(build) {
        build.onResolve(
          { filter: /^\/(landing|account|prototype\/writing)\/fonts\// },
          (args) => ({ path: args.path, external: true })
        )
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: path.join(import.meta.dirname, '../wallet/navigation.ts'),
        }))
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: path.join(import.meta.dirname, '../nft/link.tsx'),
        }))
        build.onResolve(
          { filter: /^(convex\/react|@\/convex\/_generated\/api)$/ },
          () => ({ path: runtime })
        )
      },
    },
  ],
})
if (!result.success) throw new AggregateError(result.logs)
const css = await postcss([tailwind({ base: root })]).process(
  "@import './app/globals.css';",
  { from: path.join(root, 'article-images-fixture.css') }
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
const image = await readFile(
  path.join(root, 'public/images/quilltip-cover.jpg')
)
const bodyHtml = renderArticleHtml(article)

// This deployment's storage: any /api/storage/ address answers with an image.
Bun.serve({
  hostname: '127.0.0.1',
  port: STORAGE_PORT,
  fetch(request) {
    return new URL(request.url).pathname.startsWith('/api/storage/')
      ? new Response(image, { headers: { 'Content-Type': 'image/jpeg' } })
      : new Response('Not found', { status: 404 })
  },
})

Bun.serve({
  hostname: '127.0.0.1',
  port: PAGE_PORT,
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
    const nonce = createNonce()
    // ?js=0 serves the server HTML alone, as a reader without scripts sees it.
    const script =
      url.searchParams.get('js') === '0'
        ? ''
        : `<script type="module" nonce="${nonce}" src="/${jsName}"></script>`
    return new Response(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/${cssName}"></head><body><main style="max-width:720px;margin:auto;padding:24px 16px"><section data-reader="server" class="article-content"><h2>Server HTML</h2><div class="published-prose prose prose-stone highlightable-article">${bodyHtml}</div></section><div id="root"></div></main>${script}</body></html>`,
      {
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy': buildContentSecurityPolicy(nonce, {
            NEXT_PUBLIC_CONVEX_URL: OWN_ORIGIN,
          }),
        },
      }
    )
  },
})
console.log(`Article image fixtures: http://127.0.0.1:${PAGE_PORT}`)
