// A local stand-in for the public Convex queries, like
// scripts/perf/fixture-backend.ts, with two controls: `POST /__delay?ms=N`
// holds every later query answer for N ms, and `POST /__fail?on=1` makes
// every later query fail (`on=0` restores it). Today's production check uses it
// to show that `/` answers within the public read limit when the backend is
// slow. No backend and no secrets.

import { createHash } from 'crypto'
import { createServer, type Server } from 'http'
import { answerFixtureQuery } from '../perf/convex-fixture'

export function startSlowBackend(port: number): Server {
  let delayMs = 0
  let failing = false
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    if (request.method === 'POST' && url.pathname === '/__delay') {
      delayMs = Math.max(0, Number(url.searchParams.get('ms')) || 0)
      response.writeHead(204).end()
      return
    }
    if (request.method === 'POST' && url.pathname === '/__fail') {
      failing = url.searchParams.get('on') === '1'
      response.writeHead(204).end()
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/query') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        path: string
        args: Record<string, unknown> | Record<string, unknown>[]
      }
      const args = Array.isArray(body.args) ? (body.args[0] ?? {}) : body.args
      const answer = failing ? undefined : answerFixtureQuery(body.path, args)
      if (delayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (response.destroyed) return
      response.writeHead(answer ? 200 : 560, {
        'content-type': 'application/json',
      })
      response.end(
        JSON.stringify(
          answer
            ? { status: 'success', value: answer.value }
            : { status: 'error', errorMessage: `No fixture for ${body.path}` }
        )
      )
      return
    }
    response.writeHead(404).end()
  })
  // The browser opens a sync socket: accept it and stay quiet.
  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key']
    if (!key) return socket.destroy()
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' +
        `Connection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
    socket.on('data', () => {})
    socket.on('error', () => {})
  })
  server.on('error', (error) => {
    console.error(`Slow backend could not listen on ${port}:`, error)
    process.exit(1)
  })
  server.listen(port, '127.0.0.1')
  return server
}
