/* global Bun */
// bun e2e/fixtures/avatar/server.mjs; never shipped as an application route.
import path from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = path.resolve(import.meta.dirname, '../../..')
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'avatar-convex-boundary',
      setup(build) {
        build.onResolve(
          { filter: /^(convex\/react|@\/convex\/_generated\/api)$/ },
          () => ({ path: path.join(import.meta.dirname, 'runtime.ts') })
        )
      },
    },
  ],
})
if (!result.success) throw new AggregateError(result.logs)
const css = await postcss([tailwind({ base: root })]).process(
  "@import './app/globals.css';\n@import './components/profile/public-profile.css';",
  { from: path.join(root, 'avatar-fixture.css') }
)
const script = await result.outputs[0].text()
Bun.serve({
  hostname: '127.0.0.1',
  port: 4176,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/save') return new Response('{}')
    if (url.pathname.endsWith('.svg'))
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="purple"/></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      )
    if (url.pathname === '/base.css')
      return new Response(css.css, { headers: { 'Content-Type': 'text/css' } })
    if (url.pathname === '/page.js')
      return new Response(script, {
        headers: { 'Content-Type': 'text/javascript' },
      })
    return new Response(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Avatar focus fixture</title><link rel="stylesheet" href="/base.css"></head><body><div id="root"></div><script type="module" src="/page.js"></script></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    )
  },
})
console.log('Avatar focus fixture: http://127.0.0.1:4176')
