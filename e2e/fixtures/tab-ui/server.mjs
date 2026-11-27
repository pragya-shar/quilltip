/* global Bun */
// Run explicitly with Bun. Tab UI fixture server (port 4183); it never ships
// as an app route. It bundles the real tab screens with stand-in services
// and serves the stand-in backend in backend.ts under /api.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

import {
  FixtureError,
  activity,
  applyOperation,
  prepareOperation,
  prepareTip,
  sendOperation,
  serverKey,
  settleTip,
  submitTip,
} from './backend.ts'
import { seedScenario } from './scenarios.ts'

const PORT = Number(process.env.TAB_UI_FIXTURE_PORT ?? 4183)
const root = path.resolve(import.meta.dirname, '../../..')
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'page.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [
    {
      name: 'external-fonts',
      setup(build) {
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
  { from: path.join(root, 'tab-ui-fixture.css') }
)
// The tip dialog page (/dialog, issue #546): the real tip dialogs, with
// the v2 tip fixture standing in for Convex, auth and Stellar RPC, and this
// fixture's services for the dialog's tab section.
const tipsRuntime = path.join(root, 'e2e/fixtures/tips-v2/runtime.ts')
const dialogBuild = await Bun.build({
  entrypoints: [path.join(import.meta.dirname, 'dialog.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [
    {
      name: 'tip-dialog-collaborators',
      setup(build) {
        build.onResolve(
          { filter: /^\/(landing|account|prototype\/writing)\/fonts\// },
          (args) => ({ path: args.path, external: true })
        )
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: path.join(root, 'e2e/fixtures/wallet/navigation.ts'),
        }))
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: path.join(root, 'e2e/fixtures/nft/link.tsx'),
        }))
        build.onResolve(
          { filter: /^@\/hooks\/tab\/useLiveTabServices$/ },
          () => ({
            path: path.join(import.meta.dirname, 'live-services.ts'),
          })
        )
        build.onResolve(
          {
            filter:
              /^(convex\/react|next\/dynamic|@\/(convex\/_generated\/api|components\/providers\/AuthContext|lib\/stellar\/client|lib\/stellar\/v2\/chain-runtime))$/,
          },
          () => ({ path: tipsRuntime })
        )
      },
    },
  ],
})
if (!dialogBuild.success) throw new AggregateError(dialogBuild.logs)

const named = async (outputs) =>
  Promise.all(
    outputs.map(async (output) => [
      path.basename(output.path),
      await output.text(),
    ])
  )
const pageOutputs = await named(result.outputs)
const dialogOutputs = await named(dialogBuild.outputs)
const outputs = new Map([...pageOutputs, ...dialogOutputs])
const pick = (list, ext) =>
  list.map(([name]) => name).find((name) => name.endsWith(ext))
const jsName = pick(pageOutputs, '.js')
const cssName = pick(pageOutputs, '.css')
const dialogJs = pick(dialogOutputs, '.js')
const dialogCss = pick(dialogOutputs, '.css')

/** One stand-in backend per session; pages of a session share it. */
const sessions = new Map()
function stateOf(session, scenario) {
  let state = sessions.get(session)
  if (!state) {
    state = seedScenario(scenario)
    state.seeded = false
    sessions.set(session, state)
  }
  return state
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
const refusal = (error) =>
  error instanceof FixtureError
    ? json({ code: error.code, message: error.message }, 409)
    : json({ code: 'SERVER', message: String(error) }, 500)
const never = () => new Promise(() => {})
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

let hashes = 0

async function api(url, request) {
  const body = request.method === 'POST' ? await request.json() : {}
  const session = url.searchParams.get('session') ?? body.session
  const scenario = url.searchParams.get('state') ?? body.state ?? 'home-no-tab'
  const state = stateOf(session, scenario)
  switch (url.pathname) {
    case '/api/state':
      if (state.scenario === 'home-loading') return json({ loading: true })
      return json({
        gate: state.gate,
        address: state.address,
        chainConfig: state.chainConfig,
        tab: state.tab,
        activity: activity(state),
        settlement: { settlementEnabled: state.settlementEnabled },
        earnings: state.earnings,
        claimable: state.claimable,
        clock: { ...state.clock, closedAt: Date.now() },
        rpcDown: state.rpcDown,
        funds: state.funds,
        limits: state.limits,
        calls: state.calls,
      })
    case '/api/seed-device': {
      if (state.seeded)
        return json({ keyId: state.seededKeyId ?? null, again: true })
      state.seeded = true
      const ledger = state.clock.sequence
      const day = 17_280
      const options = {
        ready: { limit: state.keySpendLimit },
        stopped: {},
        renew: { validUntil: ledger + 2 * day + 100 },
        expired: { validUntil: ledger + 100 },
        revoked: { revoked: true },
        gone: {},
        other: {},
      }[body.kind]
      if (!options || !state.tab) return json({ keyId: null })
      const keyId = state.nextKeyId
      state.nextKeyId += 1
      state.tab.keys = [
        ...state.tab.keys,
        serverKey(keyId, body.publicKey, options),
      ]
      state.seededKeyId = keyId
      return json({ keyId })
    }
    case '/api/prepare':
      try {
        return json(prepareOperation(state, body.method, body.args ?? {}))
      } catch (error) {
        return refusal(error)
      }
    case '/api/send': {
      const hash = (++hashes).toString(16).padStart(64, '0')
      const outcome = sendOperation(state, body.call, hash)
      if (outcome.hang) {
        // The step the client is on stays visible.
        return json({ hang: outcome.hang })
      }
      if (outcome.status === 'sent' && state.indexDelayMs >= 0) {
        setTimeout(
          () => applyOperation(state, body.call, body.signer),
          state.indexDelayMs
        )
      }
      await delay(150)
      return json(outcome)
    }
    case '/api/poll':
      if (state.poll === 'hang') return never()
      await delay(250)
      return json(
        { success: 'SUCCESS', failed: 'FAILED', timeout: 'TIMEOUT' }[state.poll]
      )
    case '/api/prepareTip':
      try {
        await delay(120)
        return json(prepareTip(state, body))
      } catch (error) {
        return refusal(error)
      }
    case '/api/submitTip':
      try {
        await delay(120)
        const out = submitTip(state, body, (receiptId) =>
          setTimeout(() => settleTip(state, receiptId), state.settleDelayMs)
        )
        if (out.lost) return json({ lost: true }, 503)
        return json(out)
      } catch (error) {
        return refusal(error)
      }
    case '/api/control':
      Object.assign(state, body.patch ?? {})
      return json({ ok: true })
    default:
      return json({ code: 'NOT_FOUND' }, 404)
  }
}

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return api(url, request)
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
    if (url.pathname === '/dialog')
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Tip dialog fixtures</title><link rel="stylesheet" href="/base.css">${dialogCss ? `<link rel="stylesheet" href="/${dialogCss}">` : ''}</head><body><div id="root"></div><script type="module" src="/${dialogJs}"></script></body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tab UI fixtures</title><link rel="stylesheet" href="/base.css">${cssName ? `<link rel="stylesheet" href="/${cssName}">` : ''}</head><body><div id="root"></div><script type="module" src="/${jsName}"></script></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  },
})
console.log(`Tab UI fixtures: http://127.0.0.1:${PORT}`)
