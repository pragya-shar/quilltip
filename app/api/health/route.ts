import { NextResponse } from 'next/server'

import { buildHealthReport, checkBackend } from '@/lib/health/buildHealthReport'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

export const dynamic = 'force-dynamic'

/**
 * Uptime check. Reports the build commit, deployment environment, Stellar
 * network, and whether the Convex backend answers. Returns 503 when the
 * backend is unreachable or not configured.
 */
export async function GET() {
  const backend = await checkBackend(process.env.NEXT_PUBLIC_CONVEX_URL)
  const report = buildHealthReport({
    env: process.env,
    network: STELLAR_CONFIG.NETWORK,
    backend,
  })
  return NextResponse.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
