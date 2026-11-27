// Today (`/`) on a local production build with a fixture backend: no
// script, first response, redirects, CSP, widths, a skip list, a slow and a
// failing backend. No secrets: the fixture stand-in answers the queries.
//
// Registered in scripts/app-checks/today.ts, so scripts/app-checks/run.ts
// runs it against its own app and backend (APP_BASE_URL and
// NEXT_PUBLIC_CONVEX_URL are set). On its own it starts both:
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun scripts/today/app-check.ts
//
// The slow-backend and failure checks need a backend that can be slowed and
// made to fail (`POST /__delay?ms=`, `POST /__fail?on=`). The stand-in this
// script starts has both (scripts/today/slow-backend.ts); when the runner's
// backend has neither, those checks are skipped and the log says so.
//
// The spec is e2e/today-app.spec.ts.
import { spawn } from 'child_process'
import { startSlowBackend } from './slow-backend'
import { startProductionApp } from '../perf/production-app'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.TODAY_APP_PORT ?? 3198)

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

/** Whether the backend has the delay and failure controls. */
async function hasControls(backend: string): Promise<boolean> {
  try {
    const delay = await fetch(`${backend}/__delay?ms=0`, { method: 'POST' })
    const fail = await fetch(`${backend}/__fail?on=0`, { method: 'POST' })
    return delay.status === 204 && fail.status === 204
  } catch {
    return false
  }
}

/** Resolves at the start of the next minute (the cache key of `/`). */
async function nextMinute() {
  const wait = 60_000 - (Date.now() % 60_000) + 50
  await new Promise((resolve) => setTimeout(resolve, wait))
}

/**
 * A failed read is never stored: at the start of a fresh minute (so no
 * cached answer exists for it), `/` meets a failing backend and shows the
 * unavailable state; once the backend answers again, the next request in
 * the same minute shows the opening.
 */
async function failureIsNotStored(app: string, backend: string) {
  const control = (on: 0 | 1) =>
    fetch(`${backend}/__fail?on=${on}`, { method: 'POST' })
  await nextMinute()
  await control(1)
  const failed = await (await fetch(`${app}/`)).text()
  await control(0)
  const good = await (await fetch(`${app}/`)).text()
  const unreachable = 'Today could not be loaded right now.'
  const opening = 'The lamp on Orchard Street came on every evening'
  if (!failed.includes(unreachable) || failed.includes(opening))
    throw new Error(
      'With the backend failing, / did not show the unavailable state'
    )
  if (!good.includes(opening) || good.includes(unreachable))
    throw new Error(
      'After a failed read, the next read did not show the opening: the failure was stored'
    )
  console.log('A failed read is not stored: unavailable, then the opening.')
}

async function main(): Promise<number> {
  // Under scripts/app-checks/run.ts the app and the backend are given.
  const given = process.env.APP_BASE_URL
  const backendUrl = given
    ? process.env.NEXT_PUBLIC_CONVEX_URL!
    : `http://127.0.0.1:${CONVEX_PORT}`
  const appUrl = given ?? `http://127.0.0.1:${APP_PORT}`
  const backend = given ? null : startSlowBackend(CONVEX_PORT)
  const app = given ? undefined : await startProductionApp(APP_PORT, appUrl)
  try {
    const controls = await hasControls(backendUrl)
    if (controls) await failureIsNotStored(appUrl, backendUrl)
    else
      console.warn(
        'The backend has no delay or failure controls: the failure and slow-backend checks are skipped.'
      )
    return await run(
      'bunx',
      ['playwright', 'test', '--config', 'e2e/fixtures/today/app.config.ts'],
      {
        ...process.env,
        PLAYWRIGHT_BASE_URL: appUrl,
        TODAY_APP_CHECK: '1',
        ...(controls ? { TODAY_BACKEND_URL: backendUrl } : {}),
        QUILLTIP_E2E_FIXTURES: '1',
      }
    )
  } finally {
    app?.kill()
    backend?.closeAllConnections()
    backend?.close()
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
)
