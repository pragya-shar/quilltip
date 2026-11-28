'use client'

import '../pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TextLink } from '@/system/components/TextLink'
import { sheetStack } from '@/shell/sheetStack'
import type { SheetBodyProps } from '@/shell/sheets/types'
import { notePress } from './notePress'
import { usePocketSource } from '@/lib/pocket/source'
import type { ActivityItem } from '@/lib/pocket/types'
import { recordHref, rowWords, whenLong } from '../copy'
import { ReceiptFact as Fact } from '../ReceiptFact'
import { rowAmount } from '../rowAmount'

export type ReceiptProps = { item: ActivityItem }

/**
 * One tip's receipt, over the balance (declared in shell/sheets/pocket.ts,
 * loaded when it first opens). The figure is what the row showed. The
 * exact share and Quilltip's fee are stated once, below, and only once the
 * tip is accepted. A tip received never names the reader.
 */
export default function ReceiptBody({
  props,
  close,
}: SheetBodyProps<ReceiptProps>) {
  const { format } = usePocketSource()
  const item = props.item
  const reader = item.role === 'reader'
  const words = rowWords(item)
  // What arrived and what did not, in this side's terms: the tip for the
  // reader, the share for the writer. Written by the money layer.
  const paid = reader ? item.paid : item.paidNet
  const unpaid = reader ? item.unpaid : item.unpaidNet
  const rest =
    item.status === 'not-paid' && paid.cents > 0 && unpaid ? unpaid : null
  // A tip the server has not accepted has no share or fee yet.
  const accepted = item.status !== 'sending'
  const token = item.exact ? (reader ? item.exact.gross : item.exact.net) : null
  return (
    <div className="qt-pocket__receipt" onPointerDownCapture={notePress}>
      <div className="qt-pocket__slip">
        <MoneyFigure
          value={rowAmount(item)}
          size="l"
          tone={words.status === 'failed' ? 'muted' : 'default'}
          label={
            reader
              ? `to ${item.counterparty.name} for ${item.passage ? 'this line' : 'the article'}`
              : `your share of a ${item.amount.display} tip from a reader, for ${item.passage ? 'this line' : 'your article'}`
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
              {format.money(paid.cents)}{' '}
              {reader ? 'reached the writer' : 'arrived'};{' '}
              {format.money(rest.cents)}{' '}
              {item.reason === 'shortfall'
                ? 'is waiting'
                : reader
                  ? 'is back in your balance'
                  : 'did not complete'}
            </Fact>
          ) : null}
          {rest ? <Fact label="Tip as sent">{item.amount.display}</Fact> : null}
          <Fact label="When">{whenLong(item.at)}</Fact>
          <Fact label={reader ? 'From' : 'To'}>
            {reader ? 'Your balance' : 'Your earnings'}
          </Fact>
          {accepted && words.status !== 'failed' ? (
            <Fact label={reader ? 'Writer’s share' : 'Your share'}>
              {item.fee && item.net
                ? `${format.money(item.net.cents)}, after Quilltip’s ${format.money(item.fee.cents)}`
                : '97.5%, after Quilltip’s 2.5%'}
            </Fact>
          ) : null}
          {token ? (
            <Fact label="Exact amount">
              <span className="qt-pocket__token">{format.token(token)}</span>
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
        // Leaving for the article closes this receipt and the balance under
        // it, so nothing stays open over the next page.

        <p
          className="qt-pocket__article"
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest('a')) {
              close()
              sheetStack.close('pocket')
            }
          }}
        >
          {item.article.title}{' '}
          <TextLink href={item.article.href} variant="standalone">
            Read more
          </TextLink>
        </p>
      ) : null}
    </div>
  )
}
