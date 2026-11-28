// Starts `next start` for the perf and browser checks, unless PERF_BASE_URL
// points at a server that is already running.
//
// Several checks can run on one machine at once. The helper makes sure a
// check measures the server it started and the fixture backend it started:
// - the app port comes from the environment, or is a free port;
// - it stops when the port already answers, when `next start` exits before
//   it answers, or when the answering server serves another build;
// - given the fixture backend, it stops unless that backend receives the
//   app's queries. The backend's port is fixed when the app is built, by
//   NEXT_PUBLIC_CONVEX_URL, so the build and the check must agree on it.

import { spawn, type ChildProcess } from 'child_process'
import { readFileSync } from 'fs'
import type { Server } from 'http'
import { createServer, type AddressInfo } from 'net'
import { join } from 'path'

const START_TIMEOUT_MS = 60_000

/**
 * The port in `envName`, or a free port on 127.0.0.1. Another process can
 * take a free port before the app binds it; startProductionApp then stops
 * with the reason.
 */
export async function perfPort(envName: string): Promise<number> {
  const fromEnv = process.env[envName]
  if (fromEnv) {
    const port = Number(fromEnv)
    if (!Number.isInteger(port) || port <= 0 || port > 65_535)
      throw new Error(`${envName}=${fromEnv} is not a port`)
    return port
  }
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })
}

/** The fixture backend's port: PERF_CONVEX_PORT, or the one CI builds with. */
export function fixtureBackendPort(): number {
  return Number(process.env.PERF_CONVEX_PORT ?? 3299)
}

async function answers(url: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

/** The build `next start` serves from this directory. */
function localBuildId(buildDir: string) {
  const file = join(buildDir, 'BUILD_ID')
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    throw new Error(`No production build here (${file}); run the build`)
  }
}

export interface StartOptions {
  /** The fixture backend the app should query. */
  backend?: Server
  /** Extra environment for `next start`. */
  env?: Record<string, string>
  /** For tests: the server to launch (it gets PORT), and its build folder. */
  command?: [string, ...string[]]
  buildDir?: string
}

export async function startProductionApp(
  port: number,
  baseUrl: string,
  options: StartOptions = {}
): Promise<ChildProcess | undefined> {
  if (process.env.PERF_BASE_URL) return undefined
  if (await answers(`${baseUrl}/login`))
    throw new Error(
      `Another server already answers on ${baseUrl}. Leave the port variable unset for a free port, or stop that server.`
    )
  const buildId = localBuildId(options.buildDir ?? join(process.cwd(), '.next'))

  let backendRequests = 0
  options.backend?.on('request', () => (backendRequests += 1))

  const [file, ...args] = options.command ?? [
    'bunx',
    'next',
    'start',
    '-p',
    String(port),
    '-H',
    '127.0.0.1',
  ]
  const app = spawn(file, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...options.env,
      NODE_ENV: 'production',
      PORT: String(port),
    },
  })
  let exit: string | undefined
  const stderr: string[] = []
  app.on('exit', (code, signal) => {
    exit = signal ? `signal ${signal}` : `code ${code}`
  })
  app.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk)
    stderr.push(chunk.toString())
    if (stderr.length > 20) stderr.shift()
  })

  const stop = (reason: string): never => {
    app.kill()
    throw new Error(reason)
  }
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exit !== undefined)
      stop(
        `next start exited (${exit}) before it answered on ${baseUrl}:\n${stderr.join('').trim()}`
      )
    let html: string | undefined
    try {
      const response = await fetch(`${baseUrl}/login`)
      if (response.ok) html = await response.text()
    } catch {
      /* Not listening yet. */
    }
    if (html !== undefined) {
      if (!html.includes(buildId))
        stop(
          `The server on ${baseUrl} serves another build than .next/BUILD_ID (${buildId}).`
        )
      if (options.backend)
        await expectBackend(baseUrl, () => backendRequests, stop)
      return app
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return stop(`The app did not start on ${baseUrl}`)
}

/**
 * A missing writer page always asks the backend: the proxy's route check and
 * the page's own read, neither of which keeps a missing answer.
 */
async function expectBackend(
  baseUrl: string,
  requests: () => number,
  stop: (reason: string) => never
) {
  const before = requests()
  await fetch(`${baseUrl}/perf-backend-probe`).catch(() => {})
  if (requests() === before)
    stop(
      `The app on ${baseUrl} did not query the fixture backend on port ${fixtureBackendPort()}. Build with NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:${fixtureBackendPort()}, or set PERF_CONVEX_PORT to the port of the build.`
    )
}
