'use client'

import { Button } from '@/system/components/Button'
import { sheetStack } from '@/shell/sheetStack'
import { warmSheet } from '@/shell/sheets/preload'
import {
  baseUnitsToCents,
  formatMoney,
  formatTokenAmount,
} from '@/lib/payments/money'
import { keyUntil } from '@/lib/addMoney/consent'
import { quickTipsRows, thisDevice } from '@/lib/addMoney/devices'
import type { AddMoneyServices } from '@/lib/addMoney/services'
import {
  LEDGER_FINE_PRINT,
  OFF_WHEN_SIGNED_OUT,
  balanceQuickTipsLine,
} from '@/lib/addMoney/words'

function used(
  accepted: string | null,
  limit: string | null,
  price: number | null
): string | null {
  if (!accepted || !limit) return null
  const xlm = `Used ${formatTokenAmount(accepted).replace(' XLM', '')} of ${formatTokenAmount(limit)}`
  if (!price) return xlm
  const a = formatMoney(baseUnitsToCents(BigInt(accepted), price), {
    converted: true,
  })
  const l = formatMoney(baseUnitsToCents(BigInt(limit), price), {
    converted: true,
  }).replace('≈ ', '')
  return `${xlm} (${a} of ${l})`
}

/**
 * This device's quick tips line, and every device that still has quick
 * tips with Turn off. A device turned off in Quilltip and not yet
 * confirmed by the wallet keeps its row, with Confirm in wallet, until the
 * wallet records it or it ends.
 */
export function QuickTipsPanel({ services }: { services: AddMoneyServices }) {
  const reading = services.useReading()
  if (!reading || reading.status === 'none' || !reading.address) return null
  const now = services.now()
  const device = thisDevice(reading, now)
  if (!device) return null
  const rows = quickTipsRows(reading, now)
  const line =
    device.kind === 'ready'
      ? balanceQuickTipsLine({
          kind: 'ready',
          until: keyUntil(device.validUntilLedger, reading.ledger) ?? '',
          renewSoon: device.renewSoon,
        })
      : balanceQuickTipsLine(device)
  const openSetUp = (verb: 'set-up' | 'renew') =>
    sheetStack.open('quick-tips', { verb })
  return (
    <section className="qt-quick" aria-label="Quick tips">
      <p className="qt-add__fine">
        {line}{' '}
        {device.kind === 'needs-setup' ? (
          <Button
            variant="quiet"
            {...warmSheet('quick-tips')}
            onClick={() => openSetUp(device.verb)}
          >
            {device.verb === 'renew' ? 'Renew' : 'Set up'}
          </Button>
        ) : device.kind === 'ready' && device.renewSoon ? (
          <Button
            variant="quiet"
            {...warmSheet('quick-tips')}
            onClick={() => openSetUp('renew')}
          >
            Renew now
          </Button>
        ) : null}
      </p>
      {rows.length > 0 ? (
        <>
          <h3 className="qt-add__heading">Quick tips on your devices</h3>
          <ul className="qt-quick__devices">
            {rows.map(({ key, unconfirmed }) => {
              const until = keyUntil(key.validUntilLedger, reading.ledger)
              const usage = used(
                key.acceptedTotal,
                key.spendLimit,
                reading.priceUsd
              )
              return (
                <li key={key.keyId} className="qt-quick__device">
                  <span className="qt-quick__device-text">
                    <span className="qt-quick__device-name">
                      {key.here ? 'This device' : 'Another device'}
                    </span>
                    {unconfirmed ? (
                      <span className="qt-quick__device-meta">
                        Off in Quilltip. Your wallet has not confirmed it on
                        Stellar testnet yet.
                      </span>
                    ) : (
                      <>
                        {key.here ? (
                          <span className="qt-quick__device-meta">
                            {OFF_WHEN_SIGNED_OUT}
                          </span>
                        ) : null}
                        {until ? (
                          <span className="qt-quick__device-meta">
                            Ends {until}
                          </span>
                        ) : null}
                        {usage ? (
                          <span className="qt-quick__device-meta">{usage}</span>
                        ) : null}
                      </>
                    )}
                  </span>
                  <Button
                    variant="secondary"
                    {...warmSheet('quick-tips-off')}
                    onClick={() =>
                      sheetStack.open('quick-tips-off', {
                        keyId: key.keyId,
                        here: key.here,
                      })
                    }
                  >
                    {unconfirmed ? 'Confirm in wallet' : 'Turn off'}
                  </Button>
                </li>
              )
            })}
          </ul>
          <p className="qt-add__fine">{LEDGER_FINE_PRINT}</p>
        </>
      ) : null}
    </section>
  )
}
