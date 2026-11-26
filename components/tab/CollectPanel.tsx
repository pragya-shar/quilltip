'use client'

import { useEffect, useState } from 'react'
import {
  PaymentNotice,
  TestnetLabel,
  WalletGate,
  XlmAmount,
} from '@/components/payments'
import { useTabServices } from '@/hooks/tab/TabServicesContext'
import { useDeviceKey } from '@/hooks/tab/useDeviceKey'
import { useTabOperation } from '@/hooks/tab/useTabOperation'
import { COLLECT, TAB_SETTLEMENT } from '@/lib/copy/tab'
import { formatXlm } from '@/lib/payments/format'
import { isSettlementDelayed } from '@/lib/payments/ui-state'
import { isPositive } from '@/lib/tab-ui/amounts'
import { TabOperationProgress } from './TabOperationProgress'
import { TabSkeleton } from './TabSkeleton'

/** How often the claimable amount is re-read from the Tab contract. */
const CLAIMABLE_REFRESH_MS = 30_000

/**
 * The writer's tab earnings (05-flows-and-admin.md, section 5.8): what can
 * be collected now (`claimable` on the Tab contract), what still waits for
 * settlement, and the settled gross, platform fee and the writer's share from
 * indexed `TabSettled` events. Collecting is one wallet approval
 * (`Tab.claim`); it stays open under a pause (I-27).
 */
export function CollectPanel() {
  const services = useTabServices()
  const access = services.useWalletAccess()
  const earnings = services.useMyTabEarnings()
  const device = useDeviceKey(services, null, null, null)
  const op = useTabOperation({
    surface: 'writer',
    services,
    address: access.address,
    gate: access.gate,
    tab: null,
    earnings,
    device,
  })
  const [claimable, setClaimable] = useState<string | null>(null)
  const address = access.address
  const collected = earnings?.collected
  useEffect(() => {
    if (!address) return
    let alive = true
    const read = () =>
      services
        .claimable(address)
        .then((c) => alive && setClaimable(c))
        .catch(() => alive && setClaimable(null))
    void read()
    const timer = setInterval(read, CLAIMABLE_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
    // Re-read when the indexer applies a claim.
  }, [services, address, collected])

  const heading = (
    <header>
      <h2 id="collect-title" className="tab-section-title">
        {COLLECT.heading}
      </h2>
      <p>{COLLECT.intro}</p>
    </header>
  )

  if (access.gate.kind === 'checking' || (address && earnings === undefined)) {
    return (
      <section className="tab-section" aria-labelledby="collect-title">
        {heading}
        <TabSkeleton lines={3} />
      </section>
    )
  }
  if (!address || !earnings) {
    return (
      <section className="tab-section" aria-labelledby="collect-title">
        {heading}
        <WalletGate
          state={
            access.gate.kind === 'signed-out'
              ? access.gate
              : { kind: 'unverified', ...(access.gate.kind === 'unverified' && access.gate.address ? { address: access.gate.address } : {}) }
          }
          onSignIn={access.onSignIn}
          verifyHref={access.verifyHref}
        >
          {null}
        </WalletGate>
      </section>
    )
  }

  const nothingYet = earnings.pairs === 0
  const delayed =
    earnings.settlementEnabled &&
    isPositive(earnings.pendingNet) &&
    (isSettlementDelayed(earnings.oldestUnsettledAt, services.now()) ||
      earnings.settleWindowEndsSoon)
  const canCollect = claimable !== null && isPositive(claimable)
  const running = op.view.kind !== 'idle'

  return (
    <section className="tab-section" aria-labelledby="collect-title">
      {heading}
      {!earnings.settlementEnabled && isPositive(earnings.pendingNet) ? (
        <PaymentNotice
          kind="refused"
          copy={{ title: TAB_SETTLEMENT.offTitle, detail: TAB_SETTLEMENT.offWriter }}
        />
      ) : delayed ? (
        <PaymentNotice kind="settlement-delayed" audience="writer" />
      ) : null}
      {nothingYet ? (
        <p className="tab-subtle">{COLLECT.none}</p>
      ) : (
        <>
          <dl className="tab-figures">
            <div className="tab-figure" data-primary="">
              <dt>{COLLECT.ready}</dt>
              <dd>
                {claimable === null ? '–' : <XlmAmount amount={claimable} />}
                <span className="tab-figure-note">{COLLECT.readyNote}</span>
              </dd>
            </div>
            <div className="tab-figure">
              <dt>{COLLECT.waiting}</dt>
              <dd>
                <XlmAmount amount={earnings.pendingNet} />
                <span className="tab-figure-note">{COLLECT.waitingNote}</span>
              </dd>
            </div>
          </dl>
          <dl className="tab-breakdown" aria-label={COLLECT.breakdownLabel}>
            <div>
              <dt>{COLLECT.settledGross}</dt>
              <dd>
                <XlmAmount amount={earnings.settledGross} />
              </dd>
            </div>
            <div>
              <dt>{COLLECT.fee}</dt>
              <dd>
                <XlmAmount amount={earnings.fee} />
              </dd>
            </div>
            <div>
              <dt>{COLLECT.net}</dt>
              <dd>
                <XlmAmount amount={earnings.earnedNet} />
              </dd>
            </div>
            <div>
              <dt>{COLLECT.collected}</dt>
              <dd>
                <XlmAmount amount={earnings.collected} />
              </dd>
            </div>
          </dl>
          <p className="tab-subtle">{COLLECT.feeExplainer}</p>
          <TestnetLabel />
          {earnings.unpaidPairs > 0 ? (
            <p className="tab-subtle">{COLLECT.unpaid(earnings.unpaidPairs)}</p>
          ) : null}
        </>
      )}
      {op.view.kind !== 'idle' ? (
        <TabOperationProgress
          view={op.view}
          onRetry={op.retry}
          onDone={op.reset}
          audience="writer"
          resultPlace="your wallet"
        />
      ) : null}
      {!running && !nothingYet ? (
        canCollect ? (
          <WalletGate
            state={access.gate}
            onSignIn={access.onSignIn}
            onInstall={access.onInstall}
            onConnect={access.onConnect}
            onRecheck={access.onRecheck}
            verifyHref={access.verifyHref}
          >
            <div className="tab-actions">
              <button
                type="button"
                className="tab-primary"
                onClick={() => void op.start({ flow: 'collect' })}
              >
                {COLLECT.collect(formatXlm(claimable!))}
              </button>
            </div>
          </WalletGate>
        ) : (
          <p className="tab-subtle">{COLLECT.nothing}</p>
        )
      ) : null}
    </section>
  )
}
