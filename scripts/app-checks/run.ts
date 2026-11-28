// Runs every production-build check (scripts/app-checks, one file per
// package) against one local production build. No secrets: the fixture
// stand-in answers Convex.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun scripts/app-checks/run.ts
//   bun scripts/app-checks/run.ts --only "reading without scripts"
import { spawn } from 'child_process'
import { startFixtureBackend } from '../perf/fixture-backend'
import { startProductionApp } from '../perf/production-app'
import { APP_CHECKS } from './index'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.APP_CHECK_PORT ?? 3197)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`

function run(command: readonly string[], env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve) => {
    const child = spawn(command[0]!, command.slice(1), {
      stdio: 'inherit',
      env,
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function main(): Promise<number> {
  const at = process.argv.indexOf('--only')
  const only = at === -1 ? null : process.argv[at + 1]
  const selected = APP_CHECKS.filter((c) => !only || c.name === only)
  if (selected.length === 0) throw new Error(`No check named ${only}`)
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  const failed: string[] = []
  try {
    for (const path of ['/system/reading', '/system/unreachable']) {
      await fetch(`${BASE_URL}${path}`).catch(() => {})
    }
    for (const check of selected) {
      console.log(`\n=== ${check.name}`)
      const code = await run(check.command, {
        ...process.env,
        PLAYWRIGHT_BASE_URL: BASE_URL,
        APP_BASE_URL: BASE_URL,
        NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${CONVEX_PORT}`,
        NO_SCRIPT_CHECK: '1',
        QUILLTIP_E2E_FIXTURES: '1',
      })
      if (code !== 0) failed.push(check.name)
    }
  } finally {
    app?.kill()
    backend.closeAllConnections()
    backend.close()
  }
  if (failed.length) console.error(`\nFailed: ${failed.join(', ')}`)
  else console.log(`\nAll ${selected.length} production-build checks passed.`)
  return failed.length ? 1 : 0
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
