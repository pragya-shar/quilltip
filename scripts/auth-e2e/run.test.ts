import { afterEach, expect, test } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { createServer as createTcpServer } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { perfPort } from '../perf/production-app'
import { startApp } from './run'

/**
 * The sign-in suite's runner (run.ts) serves its build through the perf
 * checks' helper (scripts/perf/production-app.ts), and its backend and app
 * stop with it. A small stand-in server plays `next start` and the local
 * backend; it runs under another process, as next-server runs under `bunx`
 * and the local backend under `convex dev`.
 */

const dir = mkdtempSync(join(tmpdir(), 'auth-e2e-run-'))
const BUILD_ID = 'auth-e2e-test-build-0001'
writeFileSync(join(dir, 'BUILD_ID'), BUILD_ID)
const STAND_IN = join(dir, 'stand-in.mjs')
writeFileSync(
  STAND_IN,
  `import { createServer } from 'http'
const { PORT, MODE, BUILD } = process.env
createServer((_req, res) => {
  res.end(MODE === 'other' ? '<html>another app</html>' : '<html>' + BUILD + '</html>')
}).listen(Number(PORT), () => console.log('READY'))
`
)
/** Runs the stand-in as a child, so the stand-in is a grandchild. */
const WRAPPER = join(dir, 'wrapper.mjs')
writeFileSync(
  WRAPPER,
  `import { spawn } from 'child_process'
spawn(process.execPath, [${JSON.stringify(STAND_IN)}], { stdio: 'inherit' })
`
)
const COMMAND: [string, ...string[]] = [
  'sh',
  '-c',
  `"${process.execPath}" "${STAND_IN}"; exit $?`,
]

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

async function freePort() {
  return perfPort('UNSET_PORT_FOR_TEST')
}

function start(port: number, mode = 'ours') {
  const app = startApp(
    port,
    { MODE: mode, BUILD: BUILD_ID },
    { command: COMMAND, buildDir: dir }
  )
  void app.then((child) => cleanups.push(() => child.kill())).catch(() => {})
  return app
}

async function expectGone(port: number) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const answers = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(500),
    }).then(
      () => true,
      () => false
    )
    if (!answers) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Port ${port} still answers after the run stopped`)
}

test('a port that accepts connections but never answers stops the run', async () => {
  // The check resets its connections when its requests time out.
  const silent = createTcpServer((socket) => socket.on('error', () => {}))
  const port = await freePort()
  // On every interface, as a server holding the port would be.
  await new Promise<void>((resolve) => silent.listen(port, resolve))
  cleanups.push(() => silent.close())
  const startedAt = Date.now()
  await expect(start(port)).rejects.toThrow('next start exited')
  // Each request to the starting app is bounded by 2 s.
  expect(Date.now() - startedAt).toBeLessThan(10_000)
}, 20_000)

test('it stops when another server already answers on the port', async () => {
  const other: Server = createServer((_req, res) => res.end('another app'))
  const port = await freePort()
  await new Promise<void>((resolve) => other.listen(port, '127.0.0.1', resolve))
  cleanups.push(() => other.close())
  await expect(start(port)).rejects.toThrow('Another server already answers')
})

test('it stops when the server serves another build', async () => {
  const port = await freePort()
  await expect(start(port, 'other')).rejects.toThrow('serves another build')
  await expectGone(port)
})

test('it serves this build, and kill stops the server', async () => {
  const port = await freePort()
  const app = await start(port)
  expect(app.exitCode).toBeNull()
  app.kill()
  await expectGone(port)
})

test('an interrupted run stops its backend and its app', async () => {
  // The runner's start-up steps in their own process, given SIGINT alone.
  const backendPort = await freePort()
  const appPort = await freePort()
  const parent = join(dir, 'interrupted-run.ts')
  writeFileSync(
    parent,
    `import { startApp, startUntil } from ${JSON.stringify(join(__dirname, 'run.ts'))}
await startUntil([${JSON.stringify(WRAPPER)}], { ...process.env, PORT: '${backendPort}' }, /READY/, 'backend')
await startApp(${appPort}, { MODE: 'ours', BUILD: ${JSON.stringify(BUILD_ID)} }, {
  command: ${JSON.stringify(COMMAND)},
  buildDir: ${JSON.stringify(dir)},
})
console.log('STARTED')
setInterval(() => {}, 1000)
`
  )
  const run = spawn('bun', [parent], { stdio: ['ignore', 'pipe', 'pipe'] })
  cleanups.push(() => run.kill('SIGKILL'))
  let output = ''
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('STARTED')) resolve()
    }
    run.stdout.on('data', onData)
    run.stderr.on('data', onData)
    run.on('exit', (code) =>
      reject(new Error(`run exited ${code}:\n${output}`))
    )
  })
  run.kill('SIGINT')
  const code = await new Promise((resolve) => run.once('exit', resolve))
  expect(code).toBe(130)
  await expectGone(backendPort)
  await expectGone(appPort)
}, 30_000)
