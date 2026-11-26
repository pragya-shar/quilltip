'use client'

import { PaymentNotice, SessionKeyRow } from '@/components/payments'
import { TAB_ACTIONS, TAB_KEYS } from '@/lib/copy/tab'
import { estimateLedgerTime, formatDay } from '@/lib/payments/format'
import { acceptsUntilLedger, type DeviceKeyView } from '@/lib/tab-ui/key-plan'
import type { LedgerClock, MyTab } from '@/lib/tab-ui/types'

type TabDeviceKeysProps = {
  tab: MyTab
  device: DeviceKeyView | undefined
  clock: LedgerClock | null
  /** The pause blocks new keys (I-27); revoking stays open. */
  paused: boolean
  /** An operation is running: actions wait. */
  busy: boolean
  onNewKey: () => void
  onRevoke: (keyId: number) => void
}

function dayOf(ledger: number, clock: LedgerClock | null): string | undefined {
  return clock ? formatDay(estimateLedgerTime(ledger, clock)) : undefined
}

/** The notice for this browser's key state, with its one next step. */
function deviceNotice(
  device: DeviceKeyView,
  canAdd: boolean,
  onNewKey: () => void
) {
  const action = canAdd ? { onClick: onNewKey } : undefined
  switch (device.kind) {
    case 'none':
    case 'other-device':
      return (
        <PaymentNotice
          kind="session-key-none"
          action={action ? { ...action, label: TAB_ACTIONS.setUpKey } : undefined}
        />
      )
    case 'gone':
      return <PaymentNotice kind="session-key-missing" action={action} />
    case 'expired':
      return <PaymentNotice kind="session-key-expired" action={action} />
    case 'revoked':
      return (
        <PaymentNotice
          kind="refused"
          copy={{ title: TAB_KEYS.revokedTitle, detail: TAB_KEYS.revokedDetail }}
        />
      )
    case 'stopped':
      return (
        <PaymentNotice
          kind="refused"
          copy={{ title: TAB_KEYS.stoppedTitle, detail: TAB_KEYS.stoppedDetail }}
        />
      )
    case 'storage-unavailable':
      return (
        <PaymentNotice
          kind="refused"
          copy={{ title: TAB_KEYS.storageTitle, detail: TAB_KEYS.storageDetail }}
        />
      )
    case 'pending':
      return (
        <PaymentNotice
          kind="refused"
          copy={{ title: TAB_KEYS.pendingTitle, detail: TAB_KEYS.pendingDetail }}
        />
      )
    case 'ready':
      return null
  }
}

/**
 * Quick tips on this device: the key state, the next step, and every key the
 * tab has, with its limit and expiry.
 */
export function TabDeviceKeys({
  tab,
  device,
  clock,
  paused,
  busy,
  onNewKey,
  onRevoke,
}: TabDeviceKeysProps) {
  const canAdd = !paused && !busy && tab.status === 'OPEN'
  const thisKeyId = device?.kind === 'ready' ? device.keyId : null
  const keys = tab.keys
    .filter((k) => !k.revoked)
    .sort((a, b) => b.keyId - a.keyId)
  const needsButton =
    device &&
    canAdd &&
    (device.kind === 'revoked' ||
      device.kind === 'stopped' ||
      device.kind === 'pending')
  const renewSoon = device?.kind === 'ready' && device.renewSoon
  const thisKey = keys.find((k) => k.keyId === thisKeyId)
  return (
    <section className="tab-section" aria-labelledby="tab-keys-title">
      <header>
        <h2 id="tab-keys-title" className="tab-section-title">
          {TAB_KEYS.heading}
        </h2>
        <p>{TAB_KEYS.intro}</p>
      </header>
      {device ? deviceNotice(device, canAdd, onNewKey) : null}
      {needsButton ? (
        <div className="tab-actions">
          <button type="button" className="tab-primary" onClick={onNewKey}>
            {device.kind === 'pending'
              ? TAB_KEYS.pendingAction
              : TAB_ACTIONS.setUpKey}
          </button>
        </div>
      ) : null}
      {renewSoon && thisKey ? (
        <div className="tab-statement">
          <p>
            {TAB_KEYS.renewSoon(
              dayOf(acceptsUntilLedger(thisKey.validUntilLedger), clock) ??
                'soon'
            )}
          </p>
          {canAdd ? (
            <div className="tab-actions">
              <button type="button" className="tab-primary" onClick={onNewKey}>
                {TAB_ACTIONS.renew}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {keys.length > 0 ? (
        <ul className="tab-list" aria-label={TAB_KEYS.heading}>
          {keys.map((key) => {
            const here = key.keyId === thisKeyId
            const stopsAt = acceptsUntilLedger(key.validUntilLedger)
            const expired = clock !== null && clock.sequence >= stopsAt
            return (
              <li key={key.keyId} className="tab-key-item">
                <SessionKeyRow
                  label={here ? TAB_KEYS.thisDevice : TAB_KEYS.otherDevice}
                  expiresAround={dayOf(stopsAt, clock)}
                  expired={expired}
                  used={key.acceptedTotal}
                  limit={key.spendLimit}
                  onRevoke={busy ? undefined : () => onRevoke(key.keyId)}
                  onRenew={here && canAdd ? onNewKey : undefined}
                />
                {here && key.extractable ? (
                  <p className="tab-subtle">{TAB_KEYS.extractable}</p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="tab-subtle">{TAB_KEYS.none}</p>
      )}
    </section>
  )
}
