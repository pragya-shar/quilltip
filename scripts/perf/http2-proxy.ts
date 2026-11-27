// Serves a local production build over HTTP/2 and TLS for Lighthouse runs, as
// the deployed site is served. `next start` speaks HTTP/1.1, which changes
// both Lighthouse methods (docs/performance/page-load.md, "Method: HTTP/2").
// Measurement only; nothing in the app depends on it.
//
// It also sets the cache headers the deployed site sends: the `headers` rules
// in vercel.json (no-store on pages and public files), and a year-long
// immutable lifetime on `/_next/static/`, as Vercel serves it. Build with
// QUILLTIP_IMMUTABLE_ASSETS=1 for Vercel's chunk paths
// (`/_next/static/immutable/`); see scripts/perf/tap-to-visible.ts.
//
//   openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=127.0.0.1 \
//     -addext subjectAltName=IP:127.0.0.1 -keyout key.pem -out cert.pem
//   PROXY_KEY=key.pem PROXY_CERT=cert.pem bun scripts/perf/http2-proxy.ts
//   bunx lighthouse@12.8.2 https://127.0.0.1:3443/login \
//     --chrome-flags="--headless=new --ignore-certificate-errors"
import http from 'http'
import http2 from 'http2'
import { readFileSync } from 'fs'
import path from 'path'

const TARGET_PORT = Number(process.env.PROXY_TARGET_PORT ?? 3104)
const PORT = Number(process.env.PROXY_PORT ?? 3443)
// Headers that HTTP/2 forbids or that belong to one connection.
const HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'te',
  'host',
])

const vercel = JSON.parse(
  readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
) as {
  headers?: { source: string; headers: { key: string; value: string }[] }[]
}
// vercel.json sources here are regular expressions over the path.
const HEADER_RULES = (vercel.headers ?? []).map((rule) => ({
  pattern: new RegExp(`^${rule.source}$`),
  headers: rule.headers,
}))
const STATIC_CACHE = 'public,max-age=31536000,immutable'

/** The cache headers the deployed site sends for this path. */
function deployedHeaders(url: string): Record<string, string> {
  const pathname = url.split('?')[0] ?? url
  if (pathname.startsWith('/_next/static/'))
    return { 'cache-control': STATIC_CACHE }
  const out: Record<string, string> = {}
  for (const rule of HEADER_RULES)
    if (rule.pattern.test(pathname))
      for (const { key, value } of rule.headers) out[key.toLowerCase()] = value
  return out
}

const server = http2.createSecureServer({
  key: readFileSync(process.env.PROXY_KEY ?? 'key.pem'),
  cert: readFileSync(process.env.PROXY_CERT ?? 'cert.pem'),
  allowHTTP1: true,
})

server.on('request', (req, res) => {
  const headers: http.OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(req.headers))
    if (!key.startsWith(':') && !HOP.has(key)) headers[key] = value
  headers.host = `127.0.0.1:${TARGET_PORT}`
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers,
    },
    (response) => {
      const out: http.OutgoingHttpHeaders = {}
      for (const [key, value] of Object.entries(response.headers))
        if (!HOP.has(key)) out[key] = value
      Object.assign(out, deployedHeaders(req.url ?? '/'))
      res.writeHead(response.statusCode ?? 502, out)
      response.pipe(res)
    }
  )
  upstream.on('error', () => res.destroy())
  req.pipe(upstream)
})

server.listen(PORT, '127.0.0.1', () =>
  console.log(`HTTP/2 proxy on https://127.0.0.1:${PORT} -> :${TARGET_PORT}`)
)
