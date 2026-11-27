'use client'

import '../pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TestnetNote } from '@/system/components/TestnetNote'
import type { SheetBodyProps } from '@/shell/sheets/types'
import { usePocketSource } from '../source'

/**
 * The exact amount behind Ready to tip: the token amount the
 * balance is held in, and what the dollar figure means. Opened by pressing
 * the figure, only while the money layer marks it as converted.
 */
export default function ExactAmountBody(_: SheetBodyProps<unknown>) {
  const source = usePocketSource()
  const balance = source.useBalance()
  const exact = balance.exact ?? null
  const price = balance.price ?? null
  const available =
    balance.status === 'ready' || balance.status === 'closing'
      ? balance.available
      : null
  if (!exact)
    return (
      <div className="qt-pocket__sheet">
        <p className="qt-pocket__plain">
          The exact amount cannot be shown right now.
        </p>
      </div>
    )
  return (
    <div className="qt-pocket__sheet">
      <p className="qt-pocket__token-figure">
        {source.format.token(exact.available)}
      </p>
      <p className="qt-pocket__plain">
        Your balance is held in Lumens.
        {available && price ? (
          // The price is named only when the money layer gives the one it used.
          <>
            {' '}
            At today&rsquo;s price of{' '}
            <MoneyFigure value={price.perToken} size="s" /> it is worth{' '}
            <MoneyFigure value={available} size="s" />; the dollar figure moves
            with the price.
          </>
        ) : (
          ' Its dollar figure moves with the price.'
        )}{' '}
        Tips are sent in dollars.
      </p>
      <TestnetNote />
    </div>
  )
}
