'use client'

import { useEffect, useRef, useState } from 'react'
import { PaymentNotice, WalletGate } from '@/components/payments'
import { useTabServices } from '@/hooks/tab/TabServicesContext'
import { useReaderTab } from '@/hooks/tab/useReaderTab'
import {
  useTabOperation,
  type OperationRequest,
} from '@/hooks/tab/useTabOperation'
import {
  TAB_ACTIONS,
  TAB_EMPTY,
  TAB_PAGE,
  TAB_SETTLEMENT,
} from '@/lib/copy/tab'
import { localKeyIds } from '@/lib/tab-ui/key-plan'
import { tabBalances, tabIsShort, tabShortBy } from '@/lib/tab-ui/tab-status'
import { TabBalance } from './TabBalance'
import { TabCloseSection } from './TabCloseSection'
import { TabDeviceKeys } from './TabDeviceKeys'
import { TabFundForm } from './TabFundForm'
import { TabOperationProgress } from './TabOperationProgress'
import { TabSkeleton } from './TabSkeleton'
import { TabTipHistory } from './TabTipHistory'

/**
 * The reader's tab: balance from chain, open and top up, quick tips on this
 * device, recent tab tips, and closing with the withdrawal. Every wallet
 * step runs through the payment kit; the indexed tab state confirms it.
 */
export function TabHome() {
  const services = useTabServices()
  const reader = useReaderTab(services)
  const {
    access,
    tab,
    status,
    device,
    clock,
    activity,
    paused,
    settlement,
    tabSettlement,
  } = reader
  // Convex accepts no quick tips: settlement is off, or its keys or the
  // Tab's state are not ready. Opening, topping up and keys wait too;
  // closing and withdrawing never do.
  const notReady = tabSettlement?.tabReady === false
  const quickTipsOff = settlement.kind === 'off' || notReady
  const op = useTabOperation({
    surface: 'reader',
    services,
    address: access.address,
    gate: access.gate,
    tab,
    device,
  })
  const [form, setForm] = useState<'open' | 'top-up' | null>(null)
  // Closing the form returns focus to the button that opened it.
  const trigger = useRef<HTMLButtonElement>(null)
  const [refocus, setRefocus] = useState(false)
  useEffect(() => {
    if (refocus && form === null) {
      trigger.current?.focus()
      setRefocus(false)
    }
  }, [refocus, form])
  const cancelForm = () => {
    setForm(null)
    setRefocus(true)
  }

  const start = (request: OperationRequest) => {
    setForm(null)
    void op.start(request)
  }
  const done = () => op.reset()

  if (status.kind === 'unavailable') {
    return (
      <PaymentNotice
        kind="refused"
        copy={{
          title: TAB_PAGE.unavailableTitle,
          detail: TAB_PAGE.unavailableDetail,
        }}
      />
    )
  }
  if (
    access.gate.kind === 'checking' ||
    (access.address &&
      (status.kind === 'loading' || tabSettlement === undefined))
  ) {
    return <TabSkeleton />
  }
  if (!access.address) {
    // A tab belongs to a verified wallet: show the gate first.
    return (
      <WalletGate
        state={
          access.gate.kind === 'signed-out' || access.gate.kind === 'unverified'
            ? access.gate
            : { kind: 'unverified' }
        }
        onSignIn={access.onSignIn}
        onVerify={undefined}
        verifyHref={access.verifyHref}
        onConnect={access.onConnect}
        onRecheck={access.onRecheck}
      >
        {null}
      </WalletGate>
    )
  }

  const running = op.view.kind !== 'idle'
  const unlocksAround =
    status.kind === 'closing' ? (status.unlocksAround ?? undefined) : undefined
  const gate = (children: React.ReactNode) => (
    <WalletGate
      state={access.gate}
      onSignIn={access.onSignIn}
      onInstall={access.onInstall}
      onConnect={access.onConnect}
      onRecheck={access.onRecheck}
      verifyHref={access.verifyHref}
    >
      {children}
    </WalletGate>
  )

  // Tips already sent exceed an open tab's balance: the Top up below is the
  // way out, so the notice carries no action of its own.
  const short = tab && tabIsShort(tab) ? tabShortBy(tab) : null
  const conditions = (
    <>
      {paused ? <PaymentNotice kind="paused" audience="reader" /> : null}
      {quickTipsOff ? (
        <PaymentNotice
          kind="refused"
          copy={{
            title: TAB_SETTLEMENT.offTitle,
            detail:
              !tab || status.kind === 'none' || status.kind === 'closed'
                ? TAB_SETTLEMENT.offNoTab
                : settlement.kind === 'off' && settlement.waiting
                  ? `${TAB_SETTLEMENT.offTab} ${TAB_SETTLEMENT.offWaiting}`
                  : TAB_SETTLEMENT.offTab,
          }}
        />
      ) : settlement.kind === 'delayed' ? (
        <PaymentNotice kind="settlement-delayed" audience="reader" />
      ) : null}
      {short ? (
        <PaymentNotice kind="insufficient-balance" source="tab" short={short} />
      ) : null}
    </>
  )

  const progress =
    op.view.kind !== 'idle' ? (
      <TabOperationProgress
        view={op.view}
        onRetry={op.retry}
        onDone={done}
        unlocksAround={unlocksAround}
      />
    ) : null

  if (!tab || status.kind === 'none' || status.kind === 'closed') {
    const closed = status.kind === 'closed'
    // The open was sent and its first events are not indexed yet: a waiting
    // state that asks for nothing, not an open tab with zero balances.
    const opening = !closed && op.confirming === 'tab-open'
    return (
      <div className="tab-page">
        {conditions}
        <section className="tab-section" aria-labelledby="tab-empty-title">
          <header>
            <h2 id="tab-empty-title" className="tab-section-title">
              {closed
                ? TAB_EMPTY.closedTitle
                : opening
                  ? TAB_EMPTY.openingTitle
                  : TAB_EMPTY.title}
            </h2>
            <p>
              {closed
                ? TAB_EMPTY.closedDetail
                : opening
                  ? TAB_EMPTY.openingDetail
                  : TAB_EMPTY.detail}
            </p>
          </header>
          {progress}
          {!running && !paused && !quickTipsOff
            ? gate(
                form === 'open' ? (
                  <TabFundForm
                    mode="open"
                    address={access.address}
                    tabBalance={tab?.confirmedBalance ?? '0'}
                    onSubmit={(amount) => start({ flow: 'tab-open', amount })}
                    onCancel={cancelForm}
                  />
                ) : (
                  <div className="tab-actions">
                    <button
                      ref={trigger}
                      type="button"
                      className="tab-primary"
                      onClick={() => setForm('open')}
                    >
                      {TAB_ACTIONS.open}
                    </button>
                  </div>
                )
              )
            : null}
        </section>
      </div>
    )
  }

  const balances = tabBalances(tab)
  const busy = op.active
  // A closing tab's next step is the withdrawal: its timeline and action
  // come before the tip history (#671). An open tab keeps "Close tab" last.
  const closeSection =
    status.kind === 'open' || status.kind === 'closing' ? (
      <TabCloseSection
        status={status}
        balance={tab.confirmedBalance}
        clock={clock}
        busy={busy || running}
        onClose={() => start({ flow: 'tab-close' })}
        onWithdraw={() => start({ flow: 'tab-withdraw' })}
      />
    ) : null
  return (
    <div className="tab-page">
      {conditions}
      <div className="tab-section">
        <TabBalance
          balances={balances}
          closing={
            status.kind === 'closing'
              ? {
                  unlocksAround: status.unlocksAround,
                  ready: status.ready,
                  overdue: status.overdue,
                }
              : null
          }
        />
        {progress}
        {!running && !paused && !quickTipsOff
          ? gate(
              form === 'top-up' ? (
                <TabFundForm
                  mode="top-up"
                  address={access.address}
                  tabBalance={tab.confirmedBalance}
                  closing={tab.status === 'CLOSING'}
                  onSubmit={(amount) => start({ flow: 'tab-top-up', amount })}
                  onCancel={cancelForm}
                />
              ) : (
                <div className="tab-actions">
                  <button
                    ref={trigger}
                    type="button"
                    className="tab-primary"
                    onClick={() => setForm('top-up')}
                  >
                    {TAB_ACTIONS.topUp}
                  </button>
                </div>
              )
            )
          : null}
      </div>
      {tab.status === 'OPEN' ? (
        <TabDeviceKeys
          tab={tab}
          device={device.view}
          localKeyIds={localKeyIds(device.localKeys)}
          clock={clock}
          paused={paused}
          quickTipsOff={quickTipsOff}
          busy={busy || running}
          onNewKey={() => start({ flow: 'tab-new-key' })}
          onRevoke={(keyId) => start({ flow: 'tab-revoke-key', keyId })}
        />
      ) : null}
      {status.kind === 'closing' ? closeSection : null}
      <TabTipHistory activity={activity ?? null} tabShort={short !== null} />
      {status.kind === 'open' ? closeSection : null}
    </div>
  )
}
