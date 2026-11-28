'use client'

import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'

/** What each cause means, for the operator; never a key or a secret. */
const CAUSE_TEXT: Record<string, string> = {
  settlement_off: 'SETTLEMENT_ENABLED is not true',
  config_missing: 'Chain config not loaded for this Tab',
  paused: 'Tab contract paused',
  settler_unset: 'TAB_SETTLER_SECRET is not set',
  settler_malformed: 'TAB_SETTLER_SECRET does not parse',
  settler_not_listed: 'Settler key does not hold the settler role',
  acceptor_unset: 'TAB_ACCEPTOR_SECRET is not set',
  acceptor_malformed: 'TAB_ACCEPTOR_SECRET does not parse',
  acceptor_not_listed: 'Acceptor key is not a Tab acceptor key',
}

const RUNBOOK =
  'https://github.com/pragya-shar/QuillTip/blob/main/docs/operations/chain-runbook.md#tab-tips-not-ready'

/**
 * Tab tip readiness and, when not ready, each failing check (#692). Rows of
 * the `/ops/chain` details list. Operators only; the query returns null to
 * everyone else.
 */
export function TabReadinessDetail() {
  const readiness = useQuery(api.chain.tabReadiness.getTabReadiness, {})
  if (!readiness) return null
  return (
    <>
      <dt>Tab tips</dt>
      <dd>
        {readiness.ready ? (
          readiness.v2Enabled ? (
            'Ready'
          ) : (
            'Ready; CHAIN_V2_ENABLED is off'
          )
        ) : (
          <span className="ops-review-flag">
            Not ready
            {readiness.v2Enabled
              ? ': readers cannot open, top up or tip from a tab'
              : ''}
          </span>
        )}
      </dd>
      {readiness.causes.length > 0 ? (
        <>
          <dt>Not ready because</dt>
          <dd>
            <ul className="ops-readiness-causes">
              {readiness.causes.map((cause) => (
                <li key={cause}>
                  {CAUSE_TEXT[cause] ?? cause} <code>{cause}</code>
                </li>
              ))}
            </ul>
            <a href={RUNBOOK}>Runbook: tab tips not ready</a>
          </dd>
        </>
      ) : null}
    </>
  )
}
