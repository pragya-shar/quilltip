import { NextResponse } from 'next/server'

import {
  buildHealthReport,
  checkBackend,
  checkTabReady,
} from '@/lib/health/buildHealthReport'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

export const dynamic = 'force-dynamic'

/**
 * Uptime check. Reports the build commit, deployment environment, Stellar
 * network, whether the Convex backend answers, and whether tab tips can be
 * offered (`tabReady`). Returns 503 when the backend is unreachable or not
 * configured; `tabReady` does not change the status.
 */
export async function GET() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
  const backend = await checkBackend(convexUrl)
  const report = buildHealthReport({
    env: process.env,
    network: STELLAR_CONFIG.NETWORK,
    backend,
    tabReady: backend === 'ok' ? await checkTabReady(convexUrl) : null,
  })
  return NextResponse.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
