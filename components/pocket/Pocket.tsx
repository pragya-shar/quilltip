'use client'

import './pocket.css'
import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Notice } from '@/system/components/Notice'
import { Skeleton } from '@/system/components/Skeleton'
import { TestnetNote } from '@/system/components/TestnetNote'
import { TextLink } from '@/system/components/TextLink'
import { BalanceIcon } from '@/system/icons'
import { useBalanceReading } from '@/shell/balance'
import { POCKET } from '@/shell/navigation'
import { openSignIn } from '@/shell/signIn'
import { usePocketSource } from '@/lib/pocket/source'
import type { EarningsView } from '@/lib/pocket/types'
import { activityLists } from './activityModel'
import { ActivitySection } from './ActivitySection'
import { ago } from './copy'
import { EarningsSection } from './EarningsSection'
import { SpendableSection } from './SpendableSection'
import { useNow } from './useNow'

/** Whether this person writes, as the money layer says: true, false, or
 * null while it does not know (loading, signed out, unavailable). */
function writerSignal(earnings: EarningsView): boolean | null {
  return earnings.isWriter ?? null
}

/** The last answer, kept through a reload of the figures or an outage, so a
 * writer never sees a reader's sheet while earnings load or fail. Forgotten
 * on sign-out. */
let lastKnownWriter: boolean | null = null

/**
 * The balance: what you can tip with, a writer's earnings kept apart, and
 * money activity with a receipt for each row. The same content in the
 * phone sheet, the desktop panel and the /pocket page. A failure of payments
 * stays here: the figures say they are unavailable and nothing else breaks.
 */
export function Pocket({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const reading = useBalanceReading()
  const source = usePocketSource()
  const wired = source.useWired()
  const balance = source.useBalance()
  const earnings = source.useEarnings()
  const reader = source.useActivity('reader')
  const writer = source.useActivity('writer')
  const now = useNow()
  const signedOut =
    reading.auth === 'signed-out' || balance.status === 'signed-out'
  if (signedOut) {
    lastKnownWriter = null
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
  }
  // Until auth is known, nobody is known to be signed in: a neutral
  // placeholder in the shape of the shell's, with no labels or words that
  // belong to a signed-in person.
  if (reading.auth === 'loading')
    return (
      <div
        className="qt-pocket"
        data-auth="loading"
        aria-busy="true"
        aria-label="Loading"
      >
        <MoneyFigure value={null} status="loading" size="xl" />
      </div>
    )
  if (!wired)
    // Before the money layer is connected: the shell's own reading of what
    // can be tipped (the bar shows the same), and plainly what is not here
    // yet, with the pages that show it today.
    return (
      <div className="qt-pocket" data-wired="false">
        <MoneyFigure
          value={reading.available}
          status={reading.status}
          size="xl"
          label="Ready to tip"
          unavailableText="Not available right now"
        />
        <Notice tone="info" title="Your tips and earnings are not here yet">
          This build does not show them in the balance yet. They are safe, and
          these pages show them today:{' '}
          <TextLink href="/dashboard/tab">your balance</TextLink> and{' '}
          <TextLink href="/dashboard/stats">your earnings</TextLink>.
        </Notice>
        <TestnetNote />
      </div>
    )
  const signal = writerSignal(earnings)
  if (signal !== null) lastKnownWriter = signal
  const isWriter = signal ?? lastKnownWriter
  const activity = activityLists(reader, writer)
  const down =
    balance.status === 'unavailable' &&
    earnings.status === 'unavailable' &&
    activity.status === 'unavailable'
  const asOf = balance.asOf ?? null
  return (
    <div className="qt-pocket" data-writer={isWriter || undefined}>
      {down ? (
        <Notice tone="info" title="Payments are not answering right now">
          Your money is safe and nothing you sent is lost. Reading works as
          usual; try again in a moment.
        </Notice>
      ) : !balance.online ? (
        <Notice tone="offline">
          {asOf
            ? `Offline. These figures are from ${ago(asOf, now)}.`
            : 'Offline. These are the last figures this device received.'}{' '}
          Tipping waits until you are back online.
        </Notice>
      ) : null}
      <SpendableSection balance={balance} compact={isWriter === true} />
      {isWriter === true ? (
        <EarningsSection earnings={earnings} headingLevel={headingLevel} />
      ) : isWriter === null && earnings.status === 'loading' ? (
        // Not yet known whether this person writes: space held at a fixed
        // height, with no heading or figures that could be wrong.
        <div
          className="qt-pocket__earn-placeholder"
          aria-busy="true"
          aria-label="Loading"
        >
          <Skeleton shape="block" height="100%" />
        </div>
      ) : null}
      <ActivitySection activity={activity} headingLevel={headingLevel} />
      <TestnetNote>
        Quilltip runs on Stellar testnet. Tips are practice money.
      </TestnetNote>
    </div>
  )
}
