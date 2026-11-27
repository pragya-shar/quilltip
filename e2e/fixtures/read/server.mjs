/* global Bun */
// Run explicitly with Bun. Read suite fixture server (port 4210); it never
// ships as an app route. It renders the fixture article's body with the
// server renderer (lib/tiptap/renderReadingHtml), bundles the article view
// inside the real application shell with next/link, next/navigation and
// convex/react replaced by stand-ins, and plays the payments backend: it
// accepts a tip's request id once. State is kept per `?run=`, so tests in
// parallel do not see each other. No backend, no secrets.
import path from 'node:path'
import { readFile } from 'node:fs/promises'

const PORT = Number(process.env.READ_FIXTURE_PORT ?? 4210)
const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const system = path.join(root, 'e2e/fixtures/system')

const { renderReadingHtml } = await import(
  path.join(root, 'lib/tiptap/renderReadingHtml.ts')
)
const { CONTENT, ARTICLE_PATH } = await import(path.join(here, 'article.ts'))
const body = renderReadingHtml(CONTENT).html
if (!body) throw new Error('The fixture article did not render')

const result = await Bun.build({
  entrypoints: [path.join(here, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [
    {
      name: 'read-collaborators',
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
        build.onResolve({ filter: /^convex\/react$/ }, () => ({
          path: path.join(here, 'convex-react.ts'),
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

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"><title>Quilltip read fixture</title><link rel="stylesheet" href="/${cssName}"></head><body><div id="root"></div><script>window.__READ_BODY__=${JSON.stringify(body)}</script><script type="module" src="/${jsName}"></script></body></html>`

const LEDGER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 533"><rect width="800" height="533" fill="#d9cfbf"/><rect x="120" y="90" width="560" height="360" fill="#f4efe6"/><path d="M400 90v360" stroke="#b9ad99" stroke-width="4"/></svg>`

/** Per run: tip requests seen, accepted request ids, saved mutations. */
const runs = new Map()
const stateOf = (url) => {
  const run = url.searchParams.get('run') ?? 'default'
  if (!runs.has(run))
    runs.set(run, {
      requests: 0,
      accepted: new Map(),
      mutations: [],
      hold: null,
    })
  return runs.get(run)
}
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const state = stateOf(url)
    if (url.pathname === '/api/tips' && request.method === 'POST') {
      const entry = await request.json()
      state.requests++
      // Held: the answer waits until the spec releases it (a reload then
      // drops this answer, and the outbox resends).
      if (state.hold) await state.hold.promise
      if (!state.accepted.has(entry.requestId))
        state.accepted.set(entry.requestId, entry)
      return json({ ok: true, requestId: entry.requestId })
    }
    if (url.pathname === '/api/tips')
      return json({
        requests: state.requests,
        accepted: [...state.accepted.values()],
      })
    if (url.pathname === '/api/hold') {
      let release
      const promise = new Promise((resolve) => (release = resolve))
      state.hold = { promise, release }
      return json({ ok: true })
    }
    if (url.pathname === '/api/release') {
      state.hold?.release()
      state.hold = null
      return json({ ok: true })
    }
    if (url.pathname === '/api/mutations' && request.method === 'POST') {
      const mutation = await request.json()
      state.mutations.push(mutation)
      return json({ id: `h${state.mutations.length}` })
    }
    if (url.pathname === '/api/mutations') return json(state.mutations)
    if (url.pathname === '/img/ledger.svg')
      return new Response(LEDGER_SVG, {
        headers: { 'Content-Type': 'image/svg+xml' },
      })
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
    if (url.pathname === '/' || url.pathname === ARTICLE_PATH)
      return new Response(page, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    return new Response('Not found', { status: 404 })
  },
})
console.log(`Read fixtures: http://127.0.0.1:${PORT}${ARTICLE_PATH}`)
