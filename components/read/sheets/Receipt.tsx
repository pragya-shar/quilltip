'use client'

import { Button } from '@/system/components/Button'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { PassageMark } from '@/system/components/PassageMark'
import { Prose } from '@/system/components/Prose'
import { TestnetNote } from '@/system/components/TestnetNote'
import type { SheetBodyProps } from '@/shell/sheets/types'
import type { ReceiptProps } from '../receipt'

/**
 * The receipt for a tip the server accepted: what was sent, to whom, for
 * which line, from where, and that it is final. It names nobody publicly
 * and offers nothing that follows or shares (D4). A lazily loaded sheet
 * body (`shell/sheets/read.ts`): its code loads when it first opens.
 */
export default function Receipt({
  props,
  close,
}: SheetBodyProps<ReceiptProps>) {
  return (
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
            <PassageMark state="mine">{props.line}</PassageMark>
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
      <Button variant="primary" block onClick={close}>
        Keep reading
      </Button>
    </div>
  )
}
