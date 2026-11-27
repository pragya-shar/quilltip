// Loads the application shell's public reading routes of a local production
// build with JavaScript off, in Chromium and WebKit (D19). No secrets: the
// fixture stand-in answers any Convex query.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun scripts/system/no-script-check.ts
//
// The spec is e2e/reading-no-script.spec.ts.
import { spawn } from 'child_process'
import { startFixtureBackend } from '../perf/fixture-backend'
import { startProductionApp } from '../perf/production-app'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.NO_SCRIPT_APP_PORT ?? 3197)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function main(): Promise<number> {
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  try {
    await fetch(`${BASE_URL}/system/reading`).catch(() => {})
    return await run(
      'bunx',
      [
        'playwright',
        'test',
        '--config',
        'e2e/fixtures/system/no-script.config.ts',
      ],
      {
        ...process.env,
        PLAYWRIGHT_BASE_URL: BASE_URL,
        NO_SCRIPT_CHECK: '1',
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
