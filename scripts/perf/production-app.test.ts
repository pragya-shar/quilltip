import { afterEach, expect, test } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { createServer as createTcpServer } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { perfPort, startProductionApp } from './production-app'

/**
 * startProductionApp (production-app.ts) stops a check that would otherwise
 * measure another server or another backend, and leaves no server behind. A
 * small stand-in server plays `next start`; it runs under a shell, so it is a
 * grandchild, as next-server is under `bunx`.
 */

const dir = mkdtempSync(join(tmpdir(), 'perf-app-'))
const BUILD_ID = 'test-build-id-0001'
writeFileSync(join(dir, 'BUILD_ID'), BUILD_ID)
const STAND_IN = join(dir, 'stand-in.mjs')
writeFileSync(
  STAND_IN,
  `import { createServer } from 'http'
const { PORT, MODE, BUILD, BACKEND } = process.env
if (MODE === 'exit') process.exit(3)
createServer(async (req, res) => {
  if (req.url === '/perf-backend-probe' && MODE === 'probe-hangs') return
  if (req.url === '/perf-backend-probe' && BACKEND)
    await fetch(BACKEND).catch(() => {})
  res.end(MODE === 'other' ? '<html>another app</html>' : '<html>' + BUILD + '</html>')
}).listen(Number(PORT), '127.0.0.1')
`
)

/** The stand-in as `next start` runs it: under another process. */
const COMMAND: [string, ...string[]] = [
  'sh',
  '-c',
  `"${process.execPath}" "${STAND_IN}"; exit $?`,
]

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

async function listen(server: Server): Promise<number> {
  const port = await perfPort('UNSET_PORT_FOR_TEST')
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve)
  )
  cleanups.push(() => server.close())
  return port
}

/** The last port start() used, to check that a stopped server is gone. */
let lastPort = 0

async function start(
  mode: string,
  options: { backend?: Server; backendUrl?: string; port?: number } = {}
) {
  const port = options.port ?? (await perfPort('UNSET_PORT_FOR_TEST'))
  lastPort = port
  const app = await startProductionApp(port, `http://127.0.0.1:${port}`, {
    backend: options.backend,
    command: COMMAND,
    buildDir: dir,
    env: { MODE: mode, BUILD: BUILD_ID, BACKEND: options.backendUrl ?? '' },
  })
  cleanups.push(() => app?.kill())
  return app
}

/** A stopped check leaves no server holding its port. */
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

test('a port from the environment, or a free one', async () => {
  process.env.TEST_PERF_PORT = '4123'
  expect(await perfPort('TEST_PERF_PORT')).toBe(4123)
  process.env.TEST_PERF_PORT = 'eighty'
  await expect(perfPort('TEST_PERF_PORT')).rejects.toThrow('is not a port')
  delete process.env.TEST_PERF_PORT
  // Free: a server can bind it.
  const port = await perfPort('TEST_PERF_PORT')
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  server.close()
})

test('it stops when another server already answers on the port', async () => {
  const other = createServer((_req, res) => res.end('another app'))
  const port = await listen(other)
  await expect(
    startProductionApp(port, `http://127.0.0.1:${port}`, { buildDir: dir })
  ).rejects.toThrow('Another server already answers')
})

test('it stops when the server exits before it answers', async () => {
  await expect(start('exit')).rejects.toThrow('exited (code 3)')
})

test('it stops when the port accepts connections but never answers', async () => {
  // The stand-in cannot bind this port and exits; requests to it hang.
  const silent = createTcpServer(() => {})
  const port = await perfPort('UNSET_PORT_FOR_TEST')
  await new Promise<void>((resolve) =>
    silent.listen(port, '127.0.0.1', resolve)
  )
  cleanups.push(() => silent.close())
  await expect(start('ours', { port })).rejects.toThrow('exited')
}, 15_000)

test('it stops when the answering server serves another build', async () => {
  await expect(start('other')).rejects.toThrow('serves another build')
  await expectGone(lastPort)
})

test('it stops when the app does not query the fixture backend', async () => {
  const backend = createServer((_req, res) => res.end('{}'))
  await listen(backend)
  // The stand-in never calls the backend.
  await expect(start('ours', { backend })).rejects.toThrow(
    'did not query the fixture backend'
  )
  await expectGone(lastPort)
})

test('it starts when the app queries the fixture backend it was given', async () => {
  const backend = createServer((_req, res) => res.end('{}'))
  const port = await listen(backend)
  const app = await start('ours', {
    backend,
    backendUrl: `http://127.0.0.1:${port}/api/query`,
  })
  expect(app?.exitCode).toBeNull()
})

test('it stops when the backend probe never answers', async () => {
  const backend = createServer((_req, res) => res.end('{}'))
  await listen(backend)
  await expect(start('probe-hangs', { backend })).rejects.toThrow(
    'did not query the fixture backend'
  )
  await expectGone(lastPort)
}, 15_000)

test("the caller's kill stops a started server", async () => {
  const backend = createServer((_req, res) => res.end('{}'))
  const port = await listen(backend)
  const app = await start('ours', {
    backend,
    backendUrl: `http://127.0.0.1:${port}/api/query`,
  })
  app?.kill()
  await expectGone(lastPort)
})

test('an interrupted check stops its server', async () => {
  // A check in its own process, given SIGINT alone (not its group).
  const parent = join(dir, 'interrupted-check.ts')
  const port = await perfPort('UNSET_PORT_FOR_TEST')
  writeFileSync(
    parent,
    `import { startProductionApp } from ${JSON.stringify(join(__dirname, 'production-app.ts'))}
await startProductionApp(${port}, 'http://127.0.0.1:${port}', {
  command: ${JSON.stringify(COMMAND)},
  buildDir: ${JSON.stringify(dir)},
  env: { MODE: 'ours', BUILD: ${JSON.stringify(BUILD_ID)} },
})
console.log('READY')
setInterval(() => {}, 1000)
`
  )
  const check = spawn('bun', [parent], { stdio: ['ignore', 'pipe', 'pipe'] })
  cleanups.push(() => check.kill('SIGKILL'))
  await new Promise<void>((resolve, reject) => {
    check.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('READY')) resolve()
    })
    check.on('exit', (code) => reject(new Error(`check exited ${code}`)))
  })
  check.kill('SIGINT')
  await new Promise((resolve) => check.once('exit', resolve))
  await expectGone(port)
}, 20_000)
