/* global Bun */
// Run explicitly with Bun. The sign-in fixture server (port 4250); it never
// ships as an app route. It bundles sign-in inside the real application
// shell, with Convex Auth replaced by ./fakeAuth.ts, next/link and
// next/navigation by the system fixture's plain stand-ins. /signin-no-script
// serves the real /signin route's server HTML with no script. No backend,
// no secrets.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const PORT = Number(process.env.SIGNIN_FIXTURE_PORT ?? 4250)
const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const system = path.join(root, 'e2e/fixtures/system')

const stand = (auth, navigation = path.join(system, 'navigation.ts')) => ({
  name: 'signin-collaborators',
  setup(build) {
    build.onResolve({ filter: /^\/fonts\// }, (args) => ({
      path: args.path,
      external: true,
    }))
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({
      path: navigation,
    }))
    build.onResolve({ filter: /^next\/link$/ }, () => ({
      path: path.join(system, 'link.tsx'),
    }))
    build.onResolve(
      { filter: /^(convex\/react|@convex-dev\/auth\/react)$/ },
      () => ({
        path: auth,
      })
    )
  },
})

const result = await Bun.build({
  entrypoints: [path.join(here, 'page.tsx')],
  target: 'browser',
  define: {
    'process.env.NODE_ENV': '"production"',
    // As next.config.ts sets it once app/(app) has a sign-in page.
    'process.env.NEXT_PUBLIC_SIGN_IN_PATH': '"/signin"',
    'process.env': '{}',
  },
  plugins: [stand(path.join(here, 'fakeAuth.ts'))],
})
if (!result.success) throw new AggregateError(result.logs)
const outputs = new Map(
  await Promise.all(
    result.outputs.map(async (o) => [path.basename(o.path), await o.text()])
  )
)
const jsName = [...outputs.keys()].find((n) => n.endsWith('.js'))
const cssName = [...outputs.keys()].find((n) => n.endsWith('.css'))

const ssr = await Bun.build({
  entrypoints: [path.join(here, 'static.tsx')],
  target: 'bun',
  outdir: path.join(tmpdir(), 'quilltip-signin-fixture-ssr'),
  define: {
    'process.env.NODE_ENV': '"production"',
    // As next.config.ts sets it once app/(app) has a sign-in page.
    'process.env.NEXT_PUBLIC_SIGN_IN_PATH': '"/signin"',
    'process.env': '{}',
  },
  plugins: [
    {
      name: 'no-css',
      setup(build) {
        build.onResolve({ filter: /\.css$/ }, (args) => ({
          path: args.path,
          namespace: 'no-css',
        }))
        build.onLoad({ filter: /.*/, namespace: 'no-css' }, () => ({
          contents: '',
          loader: 'js',
        }))
      },
    },
    {
      name: 'ssr-headers',
      setup(build) {
        build.onResolve({ filter: /^next\/headers$/ }, () => ({
          path: path.join(here, 'ssr-headers.ts'),
        }))
      },
    },
    stand(path.join(here, 'ssr-auth.ts'), path.join(here, 'ssr-navigation.ts')),
  ],
})
if (!ssr.success) throw new AggregateError(ssr.logs)
const { renderSignIn } = await import(ssr.outputs[0].path)

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
    if (url.pathname === '/signin-no-script') {
      const body = await renderSignIn(Object.fromEntries(url.searchParams))
      return new Response(html('Sign in', body, false), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    if (['/', '/article', '/signin', '/signin/reset'].includes(url.pathname))
      return new Response(html('Quilltip sign-in fixture'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    return new Response('Not found', { status: 404 })
  },
})
console.log(`Sign-in fixtures: http://127.0.0.1:${PORT}`)
