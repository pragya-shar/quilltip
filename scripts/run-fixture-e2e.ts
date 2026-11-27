/**
 * Run the Playwright suites that need no secrets and no backend: the NFT,
 * recovery, avatar, payment states, wallet, article tips, v2 tips and tab
 * session-key fixture pages (`scripts/fixture-suites.ts`). Each fixture server
 * bundles production components with stubbed wallet and Convex collaborators.
 *
 *   bun run test:e2e:fixtures
 *   bun run test:e2e:fixtures --suite payments
 *   bun run test:e2e:fixtures --suite nft,recovery,avatar
 *
 * `--suite` runs only the named suites and starts only their servers. CI runs
 * the suites as parallel shards (`.github/workflows/ci.yml`).
 */
import { spawn, type ChildProcess } from 'child_process'
import { selectFixtures } from './fixture-suites'

const READY_TIMEOUT_MS = 120_000

async function waitForPort(port: number, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Fixture server on port ${port} exited early`)
    }
    try {
      await fetch(`http://127.0.0.1:${port}/`)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Fixture server on port ${port} did not start`)
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

/** True when something already answers on the port. */
async function portAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<number> {
  const selected = selectFixtures(process.argv.slice(2))
  // A server already on a suite's port would answer in place of ours, so the
  // suite would test that server's code. Refuse instead.
  const taken: number[] = []
  for (const fixture of selected) {
    if (await portAnswers(fixture.port)) taken.push(fixture.port)
  }
  if (taken.length > 0) {
    throw new Error(
      `Port ${taken.join(', ')} is already in use. Stop that server first.`
    )
  }
  const servers = selected.map((fixture) =>
    spawn(process.execPath, [fixture.server], { stdio: 'inherit' })
  )
  try {
    await Promise.all(
      selected.map((fixture, index) =>
        waitForPort(fixture.port, servers[index]!)
      )
    )
    let failed = 0
    for (const fixture of selected) {
      const args =
        'config' in fixture
          ? ['x', 'playwright', 'test', '--config', fixture.config]
          : ['x', 'playwright', 'test', fixture.spec]
      const code = await run(process.execPath, args, {
        ...process.env,
        ...fixture.env,
        QUILLTIP_E2E_FIXTURES: '1',
      })
      if (code !== 0) failed = code
    }
    return failed
  } finally {
    for (const server of servers) server.kill()
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
