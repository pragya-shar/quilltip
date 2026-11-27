'use client'

import './pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Sheet } from '@/system/components/Sheet'
import { TextLink } from '@/system/components/TextLink'
import type { SheetComponentProps } from '@/shell/sheetRegistry'
import { ReceiptFact as Fact } from './ReceiptFact'
import { recordHref, rowWords, whenLong } from './copy'
import { usePocketSource } from './source'
import type { ActivityItem } from './types'

export type ReceiptProps = { item: ActivityItem }

/**
 * One tip's receipt, over the Pocket. The figure is the tip as sent; the
 * writer's exact share and Quilltip's fee are stated once, below. A tip
 * received names no one (D4).
 */
export function ReceiptSheet({
  open,
  onClose,
  props,
}: SheetComponentProps<ReceiptProps>) {
  const { format } = usePocketSource()
  const item = props.item
  const reader = item.role === 'reader'
  const words = rowWords(item)
  const exact = format.exactCents
  // What arrived and what did not, in this side's terms: the tip for the
  // reader, the share for the writer. Written by the money layer.
  const paid = reader ? item.paid : item.paidNet
  const unpaid = reader ? item.unpaid : item.unpaidNet
  const rest =
    item.status === 'not-paid' && paid.cents > 0 && unpaid ? unpaid : null
  return (
    <Sheet open={open} onClose={onClose} title="Receipt">
      <div className="qt-pocket__receipt">
        <div className="qt-pocket__slip">
          <MoneyFigure
            value={item.amount}
            size="m"
            tone={words.status === 'failed' ? 'muted' : 'default'}
            label={
              reader
                ? `to ${item.counterparty.name} for ${item.passage ? 'this line' : 'the article'}`
                : `from a reader for ${item.passage ? 'this line' : 'your article'}`
            }
          />
          {item.passage ? (
            <blockquote className="qt-pocket__quote">{item.passage}</blockquote>
          ) : null}
          <dl className="qt-pocket__facts">
            <Fact label="Status">
              {words.status === 'done' && !rest ? 'Final' : words.short}
            </Fact>
            {rest ? (
              <Fact label={reader ? 'Paid so far' : 'Arrived so far'}>
                {exact(paid.cents)} {reader ? 'reached the writer' : 'arrived'};{' '}
                {exact(rest.cents)}{' '}
                {item.reason === 'shortfall'
                  ? 'is waiting'
                  : reader
                    ? 'is back in your balance'
                    : 'did not complete'}
              </Fact>
            ) : null}
            <Fact label="When">{whenLong(item.at)}</Fact>
            <Fact label={reader ? 'From' : 'To'}>
              {reader ? 'Your balance' : 'Your earnings'}
            </Fact>
            {words.status === 'failed' ? null : (
              <Fact label={reader ? 'Writer’s share' : 'Your share'}>
                {item.fee
                  ? `${exact(item.net.cents)}, after Quilltip’s ${exact(item.fee.cents)}`
                  : '97.5%, after Quilltip’s 2.5%'}
              </Fact>
            )}
            {item.exact ? (
              <Fact label="Exact amount">
                <span className="qt-pocket__token">
                  {format.token(item.exact.gross)}
                </span>
              </Fact>
            ) : null}
            {item.txHash ? (
              <Fact label="Public record">
                <TextLink href={recordHref(item.txHash)} external>
                  View
                </TextLink>
              </Fact>
            ) : null}
          </dl>
        </div>
        <p className="qt-pocket__fine">{words.long}</p>
        {item.article.href ? (
          <p className="qt-pocket__article">
            {item.article.title}{' '}
            <TextLink href={item.article.href} variant="standalone">
              Read more
            </TextLink>
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
