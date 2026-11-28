import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { perfPort, startProductionApp } from './production-app'

/**
 * startProductionApp (production-app.ts) stops a check that would otherwise
 * measure another server or another backend. A small stand-in server plays
 * `next start`.
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
  if (req.url === '/perf-backend-probe' && BACKEND)
    await fetch(BACKEND).catch(() => {})
  res.end(MODE === 'other' ? '<html>another app</html>' : '<html>' + BUILD + '</html>')
}).listen(Number(PORT), '127.0.0.1')
`
)

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

async function start(
  mode: string,
  options: { backend?: Server; backendUrl?: string } = {}
) {
  const port = await perfPort('UNSET_PORT_FOR_TEST')
  const app = await startProductionApp(port, `http://127.0.0.1:${port}`, {
    backend: options.backend,
    command: [process.execPath, STAND_IN],
    buildDir: dir,
    env: { MODE: mode, BUILD: BUILD_ID, BACKEND: options.backendUrl ?? '' },
  })
  cleanups.push(() => app?.kill())
  return app
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

test('it stops when the answering server serves another build', async () => {
  await expect(start('other')).rejects.toThrow('serves another build')
})

test('it stops when the app does not query the fixture backend', async () => {
  const backend = createServer((_req, res) => res.end('{}'))
  await listen(backend)
  // The stand-in never calls the backend.
  await expect(start('ours', { backend })).rejects.toThrow(
    'did not query the fixture backend'
  )
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
