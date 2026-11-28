import { NextResponse } from 'next/server'
import {
  analyticsServerKey,
  cleanEventProperties,
  isAnalyticsEvent,
} from '@/lib/analytics/config'

// Same-origin relay to PostHog. The provider sees this server, not the
// visitor, so no visitor IP address is shared. Disabled (204) unless both the
// public flag and the server key are set. The upstream host and path are
// fixed, the body is small and capped, and only known events and properties
// are forwarded.

const DEFAULT_HOST = 'https://eu.i.posthog.com'
const MAX_BODY = 2_048
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function empty(status: number) {
  return new NextResponse(null, { status })
}

/** Rejects requests a browser marks as coming from another site. */
function isCrossSite(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return true
  }
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host !== new URL(request.url).host
  } catch {
    return true
  }
}

/** Reads at most `limit` bytes; returns null when the body is larger. */
async function readLimited(
  request: Request,
  limit: number
): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > limit) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function cleanPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/'
  if (value.startsWith('//')) return '/'
  return value.split(/[?#]/)[0]!.slice(0, 200)
}

export async function POST(request: Request) {
  const key = analyticsServerKey()
  if (!key) return empty(204)
  if (isCrossSite(request)) return empty(403)

  const text = await readLimited(request, MAX_BODY)
  if (text === null) return empty(413)
  let payload: {
    event?: unknown
    distinctId?: unknown
    path?: unknown
    properties?: unknown
  }
  try {
    payload = JSON.parse(text)
  } catch {
    return empty(400)
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !isAnalyticsEvent(payload.event) ||
    typeof payload.distinctId !== 'string' ||
    !UUID.test(payload.distinctId)
  ) {
    return empty(400)
  }
  const path = cleanPath(payload.path)
  const host = (process.env.ANALYTICS_POSTHOG_HOST || DEFAULT_HOST).replace(
    /\/$/,
    ''
  )

  try {
    await fetch(`${host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        event: payload.event,
        distinct_id: payload.distinctId,
        properties: {
          ...cleanEventProperties(payload.event, payload.properties),
          $current_url: path,
          $pathname: path,
          // Anonymous events: no person profiles, no IP stored.
          $process_person_profile: false,
          $ip: null,
        },
      }),
      signal: AbortSignal.timeout(3_000),
    })
  } catch {
    // Dropped events are acceptable; never surface provider errors.
  }
  return empty(204)
}
