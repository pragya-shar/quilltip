import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startFixtureBackend } from './fixture-backend'

let base = ''
let server: ReturnType<typeof startFixtureBackend>

beforeAll(async () => {
  server = startFixtureBackend(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const query = () =>
  fetch(`${base}/api/query`, {
    method: 'POST',
    body: JSON.stringify({ path: 'today:opening', args: { at: 1 } }),
  })

test('the failure control fails queries until it is turned off', async () => {
  expect((await fetch(`${base}/__fail?on=1`, { method: 'POST' })).status).toBe(
    204
  )
  expect((await query()).status).toBe(560)
  expect((await fetch(`${base}/__fail?on=0`, { method: 'POST' })).status).toBe(
    204
  )
  expect((await query()).status).toBe(200)
})

test('the delay control holds answers until it is set back to 0', async () => {
  expect(
    (await fetch(`${base}/__delay?ms=300`, { method: 'POST' })).status
  ).toBe(204)
  const started = Date.now()
  expect((await query()).status).toBe(200)
  expect(Date.now() - started).toBeGreaterThanOrEqual(280)
  await fetch(`${base}/__delay?ms=0`, { method: 'POST' })
  const again = Date.now()
  await query()
  expect(Date.now() - again).toBeLessThan(250)
})
