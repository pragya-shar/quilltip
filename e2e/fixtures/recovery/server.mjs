/* global Bun */
// Run with `bun e2e/fixtures/recovery/server.mjs`; never shipped as an app route.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = path.resolve(import.meta.dirname, '../../..')
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'fixture-navigation',
      setup(build) {
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: path.join(import.meta.dirname, 'link.tsx'),
        }))
      },
    },
  ],
})
if (!result.success) throw new AggregateError(result.logs)
const css = await postcss([tailwind({ base: root })]).process(
  "@import 'tailwindcss';\n@import './app/shared-ui.css';\n@import './components/articles/reader.css';\n@import './components/error/failure.css';",
  { from: path.join(root, 'recovery-fixture.css') }
)
const script = await result.outputs[0].text()
Bun.serve({
  hostname: '127.0.0.1',
  port: 4175,
  async fetch(request) {
    const url = new URL(request.url)
    if (
      url.pathname.startsWith('/landing/fonts/') ||
      url.pathname.startsWith('/account/fonts/')
    ) {
      return new Response(
        await readFile(path.join(root, 'public', url.pathname))
      )
    }
    if (url.pathname === '/base.css')
      return new Response(css.css, { headers: { 'Content-Type': 'text/css' } })
    if (url.pathname === '/page.js')
      return new Response(script, {
        headers: { 'Content-Type': 'text/javascript' },
      })
    return new Response(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Recovery fixtures</title><link rel="stylesheet" href="/base.css"></head><body><div id="root"></div><script type="module" src="/page.js"></script></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    )
  },
})
console.log('Recovery fixtures: http://127.0.0.1:4175')
