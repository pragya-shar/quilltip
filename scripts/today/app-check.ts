// Today (`/`) on a local production build with the fixture backend: no
// script, first response, redirects, CSP, widths, a slow backend. No secrets: the fixture
// stand-in answers the public queries.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun scripts/today/app-check.ts
//
// The spec is e2e/today-app.spec.ts.
import { spawn } from 'child_process'
import { startSlowBackend } from './slow-backend'
import { startProductionApp } from '../perf/production-app'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.TODAY_APP_PORT ?? 3198)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

/**
 * A failed read is never stored: the first request to `/` meets a
 * failing backend and shows the unreachable state; once the backend answers
 * again, the next request in the same minute shows the opening. Runs before
 * anything else asks for `/`, so the cache is empty for this minute.
 */
async function failureIsNotStored(backend: string) {
  const control = (on: 0 | 1) =>
    fetch(`${backend}/__fail?on=${on}`, { method: 'POST' })
  await control(1)
  const failed = await (await fetch(`${BASE_URL}/`)).text()
  await control(0)
  const good = await (await fetch(`${BASE_URL}/`)).text()
  const unreachable = 'Today could not be loaded right now.'
  const opening = 'The lamp on Orchard Street came on every evening'
  if (!failed.includes(unreachable) || failed.includes(opening))
    throw new Error(
      'With the backend failing, / did not show the unreachable state'
    )
  if (!good.includes(opening) || good.includes(unreachable))
    throw new Error(
      'After a failed read, the next read did not show the opening: the failure was stored'
    )
  console.log('A failed read is not stored: unreachable, then the opening.')
}

async function main(): Promise<number> {
  // The fixture answers, with a delay the slow-backend test can set.
  const backend = startSlowBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  try {
    await failureIsNotStored(`http://127.0.0.1:${CONVEX_PORT}`)
    return await run(
      'bunx',
      ['playwright', 'test', '--config', 'e2e/fixtures/today/app.config.ts'],
      {
        ...process.env,
        PLAYWRIGHT_BASE_URL: BASE_URL,
        TODAY_APP_CHECK: '1',
        TODAY_BACKEND_URL: `http://127.0.0.1:${CONVEX_PORT}`,
        QUILLTIP_E2E_FIXTURES: '1',
      }
    )
  } finally {
    app?.kill()
    backend.closeAllConnections()
    backend.close()
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
