// Runs e2e/early-taps.spec.ts (presses made before the page scripts run) and
// e2e/server-forms.spec.ts (forms in the server HTML post) in Chromium and
// WebKit against a local production build. It needs no
// secrets: the public Convex queries are answered by the fixture stand-in
// that the page-load budget also uses, and the spec answers the Convex
// connection itself.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run test:e2e:early-taps
//
// PLAYWRIGHT_BASE_URL runs the spec against a server that is already
// running instead.

import { spawn } from 'child_process'
import { startFixtureBackend } from './fixture-backend'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.EARLY_TAPS_APP_PORT ?? 3197)
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${APP_PORT}`

async function waitForApp(): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE_URL}/login`)).ok) return
    } catch {
      /* Not listening yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`The app did not start on ${BASE_URL}`)
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function main(): Promise<number> {
  const external = !!process.env.PLAYWRIGHT_BASE_URL
  const backend = external ? undefined : startFixtureBackend(CONVEX_PORT)
  const app = external
    ? undefined
    : spawn('bunx', ['next', 'start', '-p', String(APP_PORT)], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, NODE_ENV: 'production' },
      })
  try {
    await waitForApp()
    // Warm the routes, so a cold start cannot race the first assertions.
    for (const path of [
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password',
      '/waitlist',
      '/articles',
    ])
      await fetch(`${BASE_URL}${path}`).catch(() => {})
    return await run(
      'bunx',
      ['playwright', 'test', '--config', 'e2e/early-taps.config.ts'],
      {
        ...process.env,
        PLAYWRIGHT_BASE_URL: BASE_URL,
        // The Playwright global setup runs the testnet guard. The backend is
        // the local stand-in, so the guard sees only local and testnet values.
        QUILLTIP_NETWORK_GUARD_OPT_IN: 'testnet',
        NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${CONVEX_PORT}`,
        NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
      }
    )
  } finally {
    app?.kill()
    backend?.closeAllConnections()
    backend?.close()
  }
}

process.exit(await main())
