// A local stand-in for the public Convex queries, serving synthetic data from
// convex-fixture.ts. Browser checks build the app with
// NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:<port> and run against it, so they
// need no backend and no secrets.

import { createHash } from 'crypto'
import { createServer, type Server } from 'http'
import { answerFixtureQuery } from './convex-fixture'

export function startFixtureBackend(port: number): Server {
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/query') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        path: string
        args: Record<string, unknown> | Record<string, unknown>[]
      }
      const args = Array.isArray(body.args) ? (body.args[0] ?? {}) : body.args
      const answer = answerFixtureQuery(body.path, args)
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
  // The browser client opens a sync socket. Accept it and stay quiet, so pages
  // keep the server-rendered data, as they do until live data arrives.
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
  // A busy port means another server would answer the app's queries; stop
  // rather than measure against it.
  server.on('error', (error) => {
    console.error(`Fixture backend could not listen on ${port}:`, error)
    process.exit(1)
  })
  server.listen(port, '127.0.0.1')
  return server
}
