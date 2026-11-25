import { NextResponse } from 'next/server'
import { ANALYTICS_ENABLED, isAnalyticsEvent } from '@/lib/analytics/config'

// Same-origin relay to PostHog. The provider sees this server, not the
// visitor, so no visitor IP address is shared. Disabled (204) unless both the
// public flag and the server key are set.

const DEFAULT_HOST = 'https://eu.i.posthog.com'
const MAX_BODY = 2_048
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cleanProperties(value: unknown) {
  const result: Record<string, string | number | boolean> = {}
  if (!value || typeof value !== 'object') return result
  for (const [key, raw] of Object.entries(value).slice(0, 10)) {
    if (!/^[a-z_]{1,40}$/.test(key)) continue
    if (typeof raw === 'string') result[key] = raw.slice(0, 100)
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = raw
    else if (typeof raw === 'boolean') result[key] = raw
  }
  return result
}

export async function POST(request: Request) {
  const key = process.env.ANALYTICS_POSTHOG_KEY
  if (!ANALYTICS_ENABLED || !key) return new NextResponse(null, { status: 204 })

  const text = await request.text()
  if (text.length > MAX_BODY) return new NextResponse(null, { status: 413 })
  let payload: {
    event?: unknown
    distinctId?: unknown
    path?: unknown
    properties?: unknown
  }
  try {
    payload = JSON.parse(text)
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  if (
    !isAnalyticsEvent(payload.event) ||
    typeof payload.distinctId !== 'string' ||
    !UUID.test(payload.distinctId)
  ) {
    return new NextResponse(null, { status: 400 })
  }
  const path =
    typeof payload.path === 'string' && payload.path.startsWith('/')
      ? payload.path.split(/[?#]/)[0]!.slice(0, 200)
      : '/'
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
          ...cleanProperties(payload.properties),
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
  return new NextResponse(null, { status: 204 })
}
