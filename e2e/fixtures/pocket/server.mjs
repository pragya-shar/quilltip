/* global Bun */
// Run explicitly with Bun. The Pocket fixture server (port 4186); it never
// ships as an app route. It bundles the Pocket inside the real application
// shell, with next/link and next/navigation replaced by the system
// fixture's plain stand-ins, and the money from ./scenarios.ts. No backend,
// no secrets.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const PORT = Number(process.env.POCKET_FIXTURE_PORT ?? 4186)
const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const system = path.join(root, 'e2e/fixtures/system')
const result = await Bun.build({
  entrypoints: [path.join(here, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [
    {
      name: 'pocket-collaborators',
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
        // The shell's Pocket content, until the shell takes the surface's.
        build.onResolve({ filter: /(^|\/)PocketContent$/ }, () => ({
          path: path.join(here, 'PocketContentShim.tsx'),
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

// /pocket-no-script: the page as the server renders it before any script
// (React's server renderer over the same components), served with no
// script at all, for the no-script projects.
const ssr = await Bun.build({
  entrypoints: [path.join(here, 'static.tsx')],
  target: 'bun',
  outdir: path.join(tmpdir(), 'quilltip-pocket-fixture-ssr'),
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [
    {
      name: 'pocket-ssr',
      setup(build) {
        build.onResolve({ filter: /\.css$/ }, (args) => ({
          path: args.path,
          namespace: 'no-css',
        }))
        build.onLoad({ filter: /.*/, namespace: 'no-css' }, () => ({
          contents: '',
          loader: 'js',
        }))
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: path.join(here, 'ssr-navigation.ts'),
        }))
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: path.join(system, 'link.tsx'),
        }))
      },
    },
  ],
})
if (!ssr.success) throw new AggregateError(ssr.logs)
const { renderPocket } = await import(ssr.outputs[0].path)
const noScriptBody = renderPocket()

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
    if (url.pathname === '/pocket-no-script')
      return new Response(html('Balance', noScriptBody, false), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    if (['/', '/article', '/pocket', '/elsewhere'].includes(url.pathname))
      return new Response(html('Quilltip Pocket fixture'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    return new Response('Not found', { status: 404 })
  },
})
console.log(`Pocket fixtures: http://127.0.0.1:${PORT}`)
