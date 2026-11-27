'use client'

import { Button } from '@/system/components/Button'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { PassageMark } from '@/system/components/PassageMark'
import { Prose } from '@/system/components/Prose'
import { Sheet } from '@/system/components/Sheet'
import { TestnetNote } from '@/system/components/TestnetNote'
import { registerSheet, type SheetComponentProps } from '@/shell/sheetRegistry'
import type { Money } from '@/hooks/read/payments'

export const RECEIPT_SHEET = 'read-receipt'

export type ReceiptProps = {
  amount: Money
  writerName: string
  articleTitle: string
  /** The tipped line, or null for a tip on the whole article. */
  line: string | null
}

/**
 * The receipt for a tip the server accepted, as a sheet over the article:
 * what was sent, to whom, for which line, from where, and that it is final.
 * It names nobody publicly and offers nothing that follows or shares (D4).
 */
export function ReceiptSheet({
  open,
  onClose,
  props,
}: SheetComponentProps<ReceiptProps>) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Receipt"
      actions={
        <Button variant="primary" block onClick={onClose}>
          Keep reading
        </Button>
      }
    >
      <div className="qt-receipt">
        <MoneyFigure size="l" value={props.amount} />
        <p className="qt-receipt__to">
          {props.line
            ? `to ${props.writerName} for this line`
            : `to ${props.writerName} for “${props.articleTitle}”`}
        </p>
        {props.line ? (
          <Prose variant="line" className="qt-receipt__line">
            <p>
              <PassageMark heat={3}>{props.line}</PassageMark>
            </p>
          </Prose>
        ) : null}
        <dl className="qt-receipt__rows">
          <div className="qt-receipt__row">
            <dt>From</dt>
            <dd>Your balance</dd>
          </div>
          <div className="qt-receipt__row">
            <dt>Status</dt>
            <dd>Final</dd>
          </div>
        </dl>
        <TestnetNote />
      </div>
    </Sheet>
  )
}

registerSheet<ReceiptProps>(RECEIPT_SHEET, ReceiptSheet)
