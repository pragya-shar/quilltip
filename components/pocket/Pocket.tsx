'use client'

import './pocket.css'
import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { Notice } from '@/system/components/Notice'
import { TestnetNote } from '@/system/components/TestnetNote'
import { BalanceIcon } from '@/system/icons'
import { useBalanceReading } from '@/shell/balance'
import { POCKET } from '@/shell/navigation'
import { openSignIn } from '@/shell/signIn'
import { mergeActivity } from './activityModel'
import { ActivitySection } from './ActivitySection'
import { EarningsSection } from './EarningsSection'
import { usePocketSource } from './source'
import { SpendableSection } from './SpendableSection'
import type { EarningsView } from './types'

/** Whether to show a writer's figures. The money layer is asked for a flag
 * (`isWriter`); until then, any tip received or money collected. */
function writes(earnings: EarningsView): boolean {
  if (earnings.isWriter !== undefined) return earnings.isWriter
  if (earnings.status !== 'ready') return false
  const c = earnings.counts
  const tips = c ? c.pending + c.onHold + c.notPaid + c.settled : 0
  return tips > 0 || (earnings.collected?.cents ?? 0) > 0
}

/**
 * The balance: what you can tip with, a writer's earnings kept apart, and
 * money activity with a receipt for each row. The same content in the
 * phone sheet, the desktop panel and the /pocket page. A failure of payments
 * stays here: the figures say they are unavailable and nothing else breaks.
 */
export function Pocket({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const reading = useBalanceReading()
  const source = usePocketSource()
  const balance = source.useBalance()
  const earnings = source.useEarnings()
  const reader = source.useActivity('reader')
  const writer = source.useActivity('writer')
  const signedOut =
    reading.auth === 'signed-out' || balance.status === 'signed-out'
  if (signedOut)
    return (
      <div className="qt-pocket">
        <EmptyState
          icon={BalanceIcon}
          title="Sign in to see your balance and your tips."
          action={
            // The sign-in sheet when the Account surface has registered it;
            // otherwise the link goes to the sign-in page.
            <span
              onClickCapture={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return
                if (openSignIn()) event.preventDefault()
              }}
            >
              <Button variant="primary" href={POCKET.signIn}>
                Sign in
              </Button>
            </span>
          }
        />
        <TestnetNote />
      </div>
    )
  // Until auth is known nothing has answered: everything holds its space.
  const authLoading = reading.auth === 'loading'
  const activity = authLoading
    ? { ...mergeActivity(reader, writer), status: 'loading' as const }
    : mergeActivity(reader, writer)
  const isWriter = !authLoading && writes(earnings)
  const down =
    !authLoading &&
    balance.status === 'unavailable' &&
    (earnings.status === 'unavailable' || earnings.status === 'signed-out') &&
    activity.status === 'unavailable'
  return (
    <div className="qt-pocket" data-writer={isWriter || undefined}>
      {down ? (
        <Notice tone="info" title="Payments are not answering right now">
          Your money is safe and nothing you sent is lost. Reading works as
          usual; try again in a moment.
        </Notice>
      ) : !authLoading && !balance.online ? (
        <Notice tone="offline" title="You are offline">
          These are the last figures this device received. Tipping waits until
          you are back online.
        </Notice>
      ) : null}
      <SpendableSection
        balance={balance}
        authLoading={authLoading}
        quietAdd={isWriter && (earnings.available?.cents ?? 0) > 0}
      />
      {isWriter ? (
        <EarningsSection earnings={earnings} headingLevel={headingLevel} />
      ) : null}
      <ActivitySection activity={activity} headingLevel={headingLevel} />
    </div>
  )
}
