import type { FunctionReturnType } from 'convex/server'
import type { api } from '@/convex/_generated/api'
import type { OutsideTabActivity } from './OutsideTabActivityList'
import { RUNBOOK_URL, formatAge } from './opsAge'

type SettlerFreshness = FunctionReturnType<
  typeof api.chain.settlerStatus.getSettlerFreshness
>

/** The state in words, so it does not rest on colour alone. */
const LEVEL_TEXT = {
  ok: 'On time.',
  warning: 'Warning: runs are missing.',
  alert: 'Alert: no run for a day.',
  unknown: 'No run recorded yet.',
} as const

/**
 * Two items of the `/ops/chain` status grid (#647): open records of tab
 * activity not accepted here, and the age of the last settler run that did
 * not fail. Undefined while loading; null for a non-operator.
 */
export function OpsSignalItems({
  outside,
  settler,
  now,
}: {
  outside: OutsideTabActivity | null | undefined
  settler: SettlerFreshness | undefined
  now: number
}) {
  return (
    <>
      <div className="ops-chain-item">
        <dt>Tab activity not accepted here</dt>
        {outside ? (
          <>
            <dd data-status={outside.rows.length > 0 ? 'ALERT' : 'OK'}>
              {outside.rows.length}
              {outside.more ? '+' : ''} open
            </dd>
            <dd className="ops-chain-note">
              {outside.rows.length > 0
                ? `Oldest ${formatAge(now - outside.rows[0]!.createdAt)} ago. `
                : null}
              <a href={`${RUNBOOK_URL}#tab-activity-not-accepted-here`}>
                Runbook: outside activity
              </a>
            </dd>
          </>
        ) : (
          <dd>—</dd>
        )}
      </div>
      <div className="ops-chain-item">
        <dt>Last settler run</dt>
        {settler ? (
          <>
            <dd data-status={settler.level.toUpperCase()}>
              {settler.ageMs === null
                ? 'None recorded'
                : `${formatAge(settler.ageMs)} ago`}
            </dd>
            <dd className="ops-chain-note">
              {LEVEL_TEXT[settler.level]}{' '}
              {settler.settlementEnabled ? null : 'Settlement is off. '}
              Warns after {formatAge(settler.warnMs)}, alerts after{' '}
              {formatAge(settler.alertMs)}.{' '}
              <a href={`${RUNBOOK_URL}#settler-not-running`}>
                Runbook: settler
              </a>
            </dd>
          </>
        ) : (
          <dd>—</dd>
        )}
      </div>
    </>
  )
}
