/* global Bun */
// Run explicitly with Bun. Payment kit fixture server; it never ships as an
// app route. The kit has no Convex or wallet imports, so nothing is stubbed.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const PORT = 4180
const root = path.resolve(import.meta.dirname, '../../..')
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [
    {
      name: 'external-fonts',
      setup(build) {
        // Fonts are served by this server from public/, not bundled.
        build.onResolve({ filter: /^\/landing\/fonts\// }, (args) => ({
          path: args.path,
          external: true,
        }))
      },
    },
  ],
})
if (!result.success) throw new AggregateError(result.logs)
const css = await postcss([tailwind({ base: root })]).process(
  "@import './app/globals.css';",
  { from: path.join(root, 'payments-fixture.css') }
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
  port: PORT,
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
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment kit fixtures</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/${cssName}"></head><body><div id="root"></div><script type="module" src="/${jsName}"></script></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  },
})
console.log(`Payment kit fixtures: http://127.0.0.1:${PORT}`)
