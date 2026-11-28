import { afterEach, expect, test } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { perfPort } from './production-app'

/**
 * perf:unpublish-refresh (unpublish-refresh.ts) starts its app through
 * production-app.ts. The check runs here as it does in CI, in its own
 * process, with a stand-in for `next start`: a `bunx` early on PATH that runs
 * a small server under a shell, so the server is a grandchild, as
 * next-server is. The stand-in answers /login with the build id, asks the
 * fixture backend when probed, and never answers an article, so the check is
 * still running when it gets SIGINT.
 */

const work = mkdtempSync(join(tmpdir(), 'unpublish-start-'))
const BUILD_ID = 'unpublish-test-build-0001'
mkdirSync(join(work, '.next'))
writeFileSync(join(work, '.next', 'BUILD_ID'), BUILD_ID)
const STAND_IN = join(work, 'stand-in.mjs')
writeFileSync(
  STAND_IN,
  `import { createServer } from 'http'
const { PORT, PERF_CONVEX_PORT, STAND_IN_MODE, STAND_IN_BUILD } = process.env
createServer(async (req, res) => {
  if (req.url === '/login') return res.end('<html>' + STAND_IN_BUILD + '</html>')
  if (req.url === '/perf-backend-probe') {
    if (STAND_IN_MODE !== 'no-backend')
      await fetch('http://127.0.0.1:' + PERF_CONVEX_PORT + '/').catch(() => {})
    return res.end('')
  }
  process.stderr.write('ARTICLE port=' + PORT + '\\n')
}).listen(Number(PORT))
`
)
const bin = join(work, 'bin')
mkdirSync(bin)
writeFileSync(
  join(bin, 'bunx'),
  `#!/bin/sh\n"${process.execPath}" "${STAND_IN}"; exit $?\n`
)
chmodSync(join(bin, 'bunx'), 0o755)

const CHECK = join(__dirname, 'unpublish-refresh.ts')

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

interface Run {
  check: ChildProcess
  stderr: () => string
  exited: Promise<number | null>
}

async function runCheck(env: Record<string, string>): Promise<Run> {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PERF_CONVEX_PORT: String(await perfPort('UNSET_PORT_FOR_TEST')),
    STAND_IN_BUILD: BUILD_ID,
    ...env,
  }
  delete childEnv.PERF_BASE_URL
  if (!env.PERF_APP_PORT) delete childEnv.PERF_APP_PORT
  const check = spawn('bun', [CHECK], {
    cwd: work,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  cleanups.push(() => check.kill('SIGKILL'))
  let stderr = ''
  check.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  check.stdout!.resume()
  const exited = new Promise<number | null>((resolve) =>
    check.once('exit', (code) => resolve(code))
  )
  return { check, stderr: () => stderr, exited }
}

/** The run's exit code, or a failure when it does not end within `ms`. */
async function endsWithin(run: Run, ms: number) {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`The check still runs after ${ms} ms`)),
      ms
    )
  })
  try {
    return await Promise.race([run.exited, late])
  } finally {
    clearTimeout(timer)
  }
}

async function expectGone(port: number) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const answers = await fetch(`http://127.0.0.1:${port}/login`, {
      signal: AbortSignal.timeout(500),
    }).then(
      () => true,
      () => false
    )
    if (!answers) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Port ${port} still answers after the check stopped`)
}

test('a port that accepts connections but never answers stops the check', async () => {
  // The check resets its connections when its requests time out.
  const silent = createServer((socket) => socket.on('error', () => {}))
  const port = await perfPort('UNSET_PORT_FOR_TEST')
  // On every interface, as a server holding the port would be.
  await new Promise<void>((resolve) => silent.listen(port, resolve))
  cleanups.push(() => silent.close())
  const run = await runCheck({ PERF_APP_PORT: String(port) })
  // Each request to the starting app is bounded by 2 s.
  expect(await endsWithin(run, 10_000)).not.toBe(0)
  expect(run.stderr()).toContain('next start exited')
}, 20_000)

test('an interrupted check leaves no server, and uses a free port', async () => {
  const run = await runCheck({})
  const port = await new Promise<number>((resolve, reject) => {
    run.check.stderr!.on('data', () => {
      const match = /ARTICLE port=(\d+)/.exec(run.stderr())
      if (match) resolve(Number(match[1]))
    })
    void run.exited.then((code) =>
      reject(new Error(`check exited ${code}:\n${run.stderr()}`))
    )
  })
  // Not a fixed port that another check could hold.
  expect(port).not.toBe(3199)
  run.check.kill('SIGINT')
  expect(await endsWithin(run, 5000)).toBe(130)
  await expectGone(port)
}, 30_000)

test('the check stops when the app does not query its fixture backend', async () => {
  const run = await runCheck({ STAND_IN_MODE: 'no-backend' })
  expect(await endsWithin(run, 15_000)).not.toBe(0)
  expect(run.stderr()).toContain('did not query the fixture backend')
}, 20_000)
