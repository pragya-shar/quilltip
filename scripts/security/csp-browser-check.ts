// Loads the main routes of a local production build in Chromium and fails on
// any content security policy violation. It needs no secrets: the public
// Convex queries are answered by the fixture stand-in that the page-load
// budget also uses.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run test:e2e:csp
//
// The spec is e2e/content-security-policy.spec.ts. See
// docs/security/content-security-policy.md.

import { spawn } from 'child_process'
import { startFixtureBackend } from '../perf/fixture-backend'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.CSP_APP_PORT ?? 3198)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`

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
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = spawn('bunx', ['next', 'start', '-p', String(APP_PORT)], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  try {
    await waitForApp()
    // The first request to a route compiles its server data; warm the routes
    // so a cold start cannot race the spec's first assertions.
    // The same routes the spec loads (`/articles` and `/login` now only redirect).
    for (const path of ['/', '/signin', '/wallet/practice']) {
      await fetch(`${BASE_URL}${path}`).catch(() => {})
    }
    return await run(
      'bunx',
      ['playwright', 'test', 'e2e/content-security-policy.spec.ts'],
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
    app.kill()
    backend.closeAllConnections()
    backend.close()
  }
}

process.exit(await main())
