/**
 * Run the Playwright suites that need no secrets and no backend: the NFT,
 * recovery, and avatar fixture pages. Each fixture server bundles production
 * components with stubbed wallet and Convex collaborators.
 *
 *   bun run test:e2e:fixtures
 */
import { spawn, type ChildProcess } from 'child_process'

const FIXTURES = [
  {
    server: 'e2e/fixtures/nft/server.mjs',
    port: 4174,
    spec: 'e2e/nft-presentation.spec.ts',
    env: { NFT_FIXTURES: '1' },
  },
  {
    server: 'e2e/fixtures/recovery/server.mjs',
    port: 4175,
    spec: 'e2e/recovery-presentation.spec.ts',
    env: { RECOVERY_FIXTURES: '1' },
  },
  {
    server: 'e2e/fixtures/avatar/server.mjs',
    port: 4176,
    spec: 'e2e/profile-avatar-focus.spec.ts',
    env: {
      AVATAR_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4176',
    },
  },
] as const

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

async function main(): Promise<number> {
  const servers = FIXTURES.map((fixture) =>
    spawn(process.execPath, [fixture.server], { stdio: 'inherit' })
  )
  try {
    await Promise.all(
      FIXTURES.map((fixture, index) =>
        waitForPort(fixture.port, servers[index]!)
      )
    )
    let failed = 0
    for (const fixture of FIXTURES) {
      const code = await run(
        process.execPath,
        ['x', 'playwright', 'test', fixture.spec],
        { ...process.env, ...fixture.env }
      )
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
