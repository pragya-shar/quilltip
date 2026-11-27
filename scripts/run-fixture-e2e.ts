/**
 * Run the Playwright suites that need no secrets and no backend: the NFT,
 * recovery, avatar, wallet, article tips, v2 article NFT and tab session-key
 * fixture pages.
 * Each fixture server bundles production components with stubbed wallet and
 * Convex collaborators.
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
  {
    server: 'e2e/fixtures/payments/server.mjs',
    port: 4180,
    spec: 'e2e/payment-states.spec.ts',
    env: {
      PAYMENT_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4180',
    },
  },
  {
    server: 'e2e/fixtures/wallet/server.mjs',
    port: 4177,
    spec: 'e2e/wallet-(states|verification|coverage|connect).spec.ts',
    env: {
      WALLET_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4177',
    },
  },
  {
    server: 'e2e/fixtures/article-tips/server.mjs',
    port: 4178,
    spec: 'e2e/article-tips.spec.ts',
    env: {
      ARTICLE_TIPS_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4178',
    },
  },
  {
    server: 'e2e/fixtures/nft-v2/server.mjs',
    port: 4182,
    spec: 'e2e/nft-v2.spec.ts',
    env: {
      NFT_V2_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4182',
    },
  },
  {
    // Chromium, Firefox and WebKit (its own config); key storage and
    // WebCrypto Ed25519 differ between engines.
    server: 'e2e/fixtures/tab/server.mjs',
    port: 4181,
    spec: 'e2e/tab-session-keys.spec.ts',
    config: 'e2e/fixtures/tab/playwright.config.ts',
    env: {},
  },
] as const satisfies readonly {
  server: string
  port: number
  spec: string
  config?: string
  env: Record<string, string>
}[]

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
