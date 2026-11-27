/**
 * Runs the sign-in suite (e2e/auth-return.spec.ts, issue #575) with real
 * Convex Auth on a local, anonymous Convex backend:
 *
 *   bun run test:e2e:auth [--skip-build] [-- <playwright args>]
 *
 * 1. Starts `convex dev` for the anonymous local deployment `anonymous-agent`
 *    and waits until the functions are pushed.
 * 2. Gives that backend a new Convex Auth signing key and SITE_URL.
 * 3. Builds the app against it (unless --skip-build) and serves it.
 * 4. Runs the suite in WebKit and Chromium at phone viewports.
 *
 * Only local backends are used. The run refuses when .env.local selects any
 * other deployment, because `convex dev` would rewrite that file.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { createServer } from 'net'
import { resolve } from 'path'

import { ConvexHttpClient } from 'convex/browser'

import { api } from '../../convex/_generated/api'
import { assertScriptConvexDeployAllowed } from '../lib/network-guard'

const repoRoot = resolve(__dirname, '../..')
const DEPLOYMENT = 'anonymous:anonymous-agent'
const READY_TIMEOUT_MS = 240_000

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

function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? done(address.port)
          : reject(new Error('no port'))
      )
    })
  })
}

function runOrFail(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.status !== 0) fail(`${args.slice(0, 4).join(' ')} failed`)
}

function stop(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

/** Starts a long-running process and resolves when `ready` matches its output. */
function startUntil(
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
    const timer = setTimeout(() => {
      stop(child)
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
  const split = argv.indexOf('--')
  const own = split === -1 ? argv : argv.slice(0, split)
  const playwrightArgs = split === -1 ? [] : argv.slice(split + 1)
  const skipBuild = own.includes('--skip-build')

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

    const appPort = Number(process.env.AUTH_E2E_PORT) || (await freePort())
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

    const appEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NEXT_PUBLIC_CONVEX_URL: convexUrl,
      NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
      NEXT_TELEMETRY_DISABLED: '1',
    }
    if (!skipBuild) runOrFail(['x', 'next', 'build'], appEnv)
    children.push(
      await startUntil(
        ['x', 'next', 'start', '-H', '127.0.0.1', '-p', String(appPort)],
        appEnv,
        /Ready in|ready on|started server/i,
        'app'
      )
    )

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
          NEXT_PUBLIC_CONVEX_URL: convexUrl,
          CONVEX_DEPLOYMENT: DEPLOYMENT,
          QUILLTIP_NETWORK_GUARD_OPT_IN: 'testnet',
          NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
        },
      }
    )
    return result.status ?? 1
  } finally {
    for (const child of children.reverse()) stop(child)
  }
}

main().then(
  (code) => {
    process.exit(code)
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
