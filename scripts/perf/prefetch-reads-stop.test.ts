import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { waitUntilStopped } from './prefetch-reads'

/**
 * perf:prefetch-reads stops its app between engines (#630) and waits until
 * nothing answers. The wait must end however the old server behaves.
 */

let server: Server | undefined
afterEach(async () => {
  server?.closeAllConnections()
  await new Promise((r) => server?.close(r) ?? r(undefined))
  server = undefined
})

async function listen(handler: Parameters<typeof createServer>[1]) {
  server = createServer(handler)
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('waitUntilStopped', () => {
  it('ends when a server accepts the connection but never answers', async () => {
    const base = await listen(() => {
      /* Never answers. */
    })
    const started = performance.now()
    await waitUntilStopped(base)
    expect(performance.now() - started).toBeLessThan(3000)
  }, 5000)

  it('ends at once when nothing listens', async () => {
    const base = await listen((_, response) => response.end())
    server!.close()
    server = undefined
    await expect(waitUntilStopped(base)).resolves.toBeUndefined()
  })

  it('fails when the old server keeps answering', async () => {
    const base = await listen((_, response) => response.end('still here'))
    await expect(waitUntilStopped(base, 3)).rejects.toThrow('still answers')
  })
})
