/**
 * Runs the sign-in suite (e2e/auth-return.spec.ts, issue #575) with real
 * Convex Auth on a local, anonymous Convex backend:
 *
 *   bun run test:e2e:auth [--skip-build] [<playwright args>]
 *
 * 1. Checks the pinned local backend binary against its recorded SHA-256
 *    (downloading it once if needed), starts `convex dev` for the anonymous
 *    local deployment `anonymous-agent` on that version, and waits until the
 *    functions are pushed.
 * 2. Gives that backend a new Convex Auth signing key and SITE_URL.
 * 3. Builds the app against it (unless --skip-build) and serves it on
 *    AUTH_E2E_PORT, or a free port, through the perf checks' start-up helper
 *    (scripts/perf/production-app.ts).
 * 4. Runs the suite in WebKit and Chromium at phone viewports.
 *
 * Only local backends are used. The run refuses when .env.local selects any
 * other deployment, because `convex dev` would rewrite that file. The backend
 * and the app stop with this process, also on SIGINT or SIGTERM; a signal
 * that comes during the build or the suite takes effect when that step ends.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { createHash, randomBytes } from 'crypto'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'

import { ConvexHttpClient } from 'convex/browser'

import { api } from '../../convex/_generated/api'
import { assertScriptConvexDeployAllowed } from '../lib/network-guard'
import {
  launchProductionApp,
  perfPort,
  stopWithThisProcess,
  type StartOptions,
} from '../perf/production-app'

const repoRoot = resolve(__dirname, '../..')
const DEPLOYMENT = 'anonymous:anonymous-agent'
const READY_TIMEOUT_MS = 240_000

/**
 * The Convex local backend release this run uses, and the SHA-256 of its
 * release zip and of the binary inside, per platform. `convex dev` would
 * otherwise fetch the newest release with no checksum. To move the pin,
 * download each zip from the release, record both hashes and change them
 * together.
 */
const LOCAL_BACKEND_VERSION = 'precompiled-2026-11-21-cf39368'
const LOCAL_BACKEND_RELEASES =
  'https://github.com/convex/convex-backend/releases/download'
const LOCAL_BACKEND_SHA256: Record<string, { zip: string; binary: string }> = {
  'aarch64-apple-darwin': {
    zip: '32530173dcd215b16e296a09f07e17e71f41f3b261136c8469fcb76af6445119',
    binary: 'c20e92b96ec806211410938c58d9321251d784984eb2a9c62e527a322b955d92',
  },
  'x86_64-unknown-linux-gnu': {
    zip: 'a7bf39daa91535b93a4c59943bcf5c963c3852b021f02be132145500904b5f1d',
    binary: '3ed17a59853cf744f50c3b962c5fa15ed0813b6c354c9ba82ba2f7d55fa1cd5f',
  },
}

function fail(message: string): never {
  throw new Error(`auth e2e: ${message}`)
}

function readEnvLocal(): Record<string, string> {
  const file = resolve(repoRoot, '.env.local')
  if (!existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) out[match[1]!] = match[2]!.replace(/^"|"$/g, '')
  }
  return out
}

function runOrFail(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.status !== 0) fail(`${args.slice(0, 4).join(' ')} failed`)
}

/**
 * Starts a long-running process and resolves when `ready` matches its output.
 * It stops with this process.
 */
export function startUntil(
  args: string[],
  env: NodeJS.ProcessEnv,
  ready: RegExp,
  label: string
): Promise<ChildProcess> {
  return new Promise((done, reject) => {
    // Its own process group, so stopping it also stops `convex dev`'s local
    // backend and the Next.js server it starts.
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      detached: true,
    })
    stopWithThisProcess(child)
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${label} did not start`))
    }, READY_TIMEOUT_MS)
    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      process.stdout.write(`[${label}] ${text}`)
      if (ready.test(text)) {
        clearTimeout(timer)
        done(child)
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`${label} exited with ${code}`))
    })
  })
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Puts the pinned backend binary where `convex dev` looks for it
 * (~/.cache/convex/binaries/<version>/), checked against the recorded
 * SHA-256. A cached binary with another hash is refused, not replaced.
 */
export async function ensurePinnedLocalBackend(): Promise<void> {
  const target =
    process.platform === 'darwin' && process.arch === 'arm64'
      ? 'aarch64-apple-darwin'
      : process.platform === 'linux' && process.arch === 'x64'
        ? 'x86_64-unknown-linux-gnu'
        : null
  const expected = target ? LOCAL_BACKEND_SHA256[target] : undefined
  if (!target || !expected) {
    fail(
      `no recorded local backend checksum for ${process.platform} ${process.arch}`
    )
  }
  const dir = join(
    homedir(),
    '.cache',
    'convex',
    'binaries',
    LOCAL_BACKEND_VERSION
  )
  const binary = join(dir, 'convex-local-backend')
  if (existsSync(binary)) {
    if (sha256(binary) !== expected.binary) {
      fail(
        `${binary} does not match the recorded SHA-256; remove it to fetch it again`
      )
    }
    return
  }
  const url = `${LOCAL_BACKEND_RELEASES}/${LOCAL_BACKEND_VERSION}/convex-local-backend-${target}.zip`
  const response = await fetch(url)
  if (!response.ok) {
    fail(`downloading the local backend: HTTP ${response.status}`)
  }
  const work = mkdtempSync(join(tmpdir(), 'convex-local-backend-'))
  try {
    const zip = join(work, 'backend.zip')
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()))
    if (sha256(zip) !== expected.zip) {
      fail(
        'the downloaded local backend zip does not match the recorded SHA-256'
      )
    }
    const unzip = spawnSync('unzip', ['-q', zip, '-d', join(work, 'out')], {
      stdio: 'inherit',
    })
    if (unzip.status !== 0) fail('unzipping the local backend failed')
    const extracted = join(work, 'out', 'convex-local-backend')
    if (sha256(extracted) !== expected.binary) {
      fail('the local backend binary does not match the recorded SHA-256')
    }
    mkdirSync(dir, { recursive: true })
    chmodSync(extracted, 0o755)
    renameSync(extracted, binary)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Serves the build with `next start`, through the perf checks' helper: it
 * stops when the port already answers, when the server serves another build
 * than .next/BUILD_ID, or when the app does not answer at localhost, and the
 * server stops with this process.
 */
export function startApp(
  port: number,
  env: Record<string, string>,
  testOptions: Pick<StartOptions, 'command' | 'buildDir'> = {}
): Promise<ChildProcess> {
  return launchProductionApp(port, `http://127.0.0.1:${port}`, {
    env,
    buildDir: resolve(repoRoot, '.next'),
    ...testOptions,
  })
}

/** A new RS256 key for Convex Auth, as scripts/generateKeys.mjs writes it. */
async function signingKey(): Promise<{ privateKey: string; jwks: string }> {
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  )
  const pkcs8 = Buffer.from(
    await crypto.subtle.exportKey('pkcs8', keys.privateKey)
  ).toString('base64')
  const pem = `-----BEGIN PRIVATE KEY----- ${pkcs8.match(/.{1,64}/g)!.join(' ')} -----END PRIVATE KEY-----`
  const { kty, n, e } = await crypto.subtle.exportKey('jwk', keys.publicKey)
  return {
    privateKey: pem,
    jwks: JSON.stringify({ keys: [{ use: 'sig', kty, n, e, alg: 'RS256' }] }),
  }
}

/**
 * A new account for this run, on the local backend. Retried: a busy machine
 * can push the password hashing past the local backend's function timeout.
 */
async function createAccount(
  convexUrl: string
): Promise<{ email: string; password: string }> {
  const account = {
    email: `reader-${randomBytes(6).toString('hex')}@example.test`,
    password: `Aa1${randomBytes(12).toString('hex')}`,
  }
  const client = new ConvexHttpClient(convexUrl)
  for (let attempt = 1; ; attempt++) {
    try {
      await client.action(api.auth.signIn, {
        provider: 'password',
        params: { ...account, flow: 'signUp', name: 'Return path reader' },
      })
      return account
    } catch (error) {
      // An earlier attempt may have created it before timing out.
      try {
        await client.action(api.auth.signIn, {
          provider: 'password',
          params: { ...account, flow: 'signIn' },
        })
        return account
      } catch {
        if (attempt >= 3) throw error
      }
    }
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  // `bun run` drops the first `--`, so every argument except the runner's
  // own flag goes to Playwright.
  const skipBuild = argv.includes('--skip-build')
  const playwrightArgs = argv.filter(
    (arg) => arg !== '--skip-build' && arg !== '--'
  )

  const configured = readEnvLocal().CONVEX_DEPLOYMENT
  if (configured && configured !== DEPLOYMENT) {
    fail(
      `.env.local selects ${configured.split(':')[0]} deployment; this run uses ${DEPLOYMENT} and convex dev would rewrite .env.local. Run it in a separate checkout.`
    )
  }

  const convexEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CONVEX_AGENT_MODE: 'anonymous',
    CONVEX_DEPLOYMENT: DEPLOYMENT,
    // Testnet settings for the app; the backend is local (checked below).
    QUILLTIP_NETWORK_GUARD_OPT_IN: 'testnet',
  }
  assertScriptConvexDeployAllowed('auth e2e backend', convexEnv)
  await ensurePinnedLocalBackend()

  const children: ChildProcess[] = []
  try {
    children.push(
      await startUntil(
        [
          'x',
          'convex',
          'dev',
          '--typecheck',
          'disable',
          '--tail-logs',
          'always',
          '--local-backend-version',
          LOCAL_BACKEND_VERSION,
        ],
        convexEnv,
        /Convex functions ready/,
        'convex'
      )
    )
    const convexUrl = readEnvLocal().NEXT_PUBLIC_CONVEX_URL
    const host = convexUrl ? new URL(convexUrl).hostname : ''
    if (host !== '127.0.0.1' && host !== 'localhost') {
      fail('the local backend URL was not written to .env.local')
    }

    const appPort = await perfPort('AUTH_E2E_PORT')
    const baseURL = `http://127.0.0.1:${appPort}`
    const { privateKey, jwks } = await signingKey()
    for (const [name, value] of [
      ['JWT_PRIVATE_KEY', privateKey],
      ['JWKS', jwks],
      ['SITE_URL', baseURL],
    ] as const) {
      runOrFail(['x', 'convex', 'env', 'set', name, '--', value], convexEnv)
    }

    // After the key: signing up issues a token signed with it.
    const account = await createAccount(convexUrl!)

    const appVars = {
      NEXT_PUBLIC_CONVEX_URL: convexUrl!,
      NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
      NEXT_TELEMETRY_DISABLED: '1',
    }
    const appEnv: NodeJS.ProcessEnv = { ...process.env, ...appVars }
    // The build holds the backend URL, and the backend's port can change
    // between runs, so a reused build must name this backend.
    const builtFor = resolve(repoRoot, '.next', 'auth-e2e-convex-url')
    if (skipBuild) {
      const previous = existsSync(builtFor)
        ? readFileSync(builtFor, 'utf8')
        : null
      if (previous !== convexUrl) {
        fail(
          `the existing build is not for ${convexUrl}; run without --skip-build`
        )
      }
    } else {
      runOrFail(['x', 'next', 'build'], appEnv)
      writeFileSync(builtFor, convexUrl!)
    }
    children.push(await startApp(appPort, appVars))

    const result = spawnSync(
      process.execPath,
      [
        'x',
        'playwright',
        'test',
        '--config',
        'e2e/auth/playwright.config.ts',
        ...playwrightArgs,
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: baseURL,
          AUTH_E2E_CONVEX_URL: convexUrl,
          AUTH_E2E_EMAIL: account.email,
          AUTH_E2E_PASSWORD: account.password,
          // This run's throwaway key on the local backend: the suite signs an
          // expired copy of a real token with it.
          AUTH_E2E_JWT_PRIVATE_KEY: privateKey,
          NEXT_PUBLIC_CONVEX_URL: convexUrl,
          CONVEX_DEPLOYMENT: DEPLOYMENT,
          QUILLTIP_NETWORK_GUARD_OPT_IN: 'testnet',
          NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
        },
      }
    )
    return result.status ?? 1
  } finally {
    for (const child of children.reverse()) child.kill()
  }
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exit(code)
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
  )
}
