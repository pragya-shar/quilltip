'use client'

import './pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Sheet } from '@/system/components/Sheet'
import { TextLink } from '@/system/components/TextLink'
import type { SheetComponentProps } from '@/shell/sheetRegistry'
import { recordHref, rowWords, whenLong } from './copy'
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
  const item = props.item
  const reader = item.role === 'reader'
  const words = rowWords(item)
  const detail = item.detail ?? null
  return (
    <Sheet open={open} onClose={onClose} title="Receipt">
      <div className="qt-pocket__receipt">
        <MoneyFigure
          value={item.amount}
          size="m"
          tone={words.status === 'failed' ? 'muted' : 'default'}
          label={
            reader
              ? `to ${item.counterparty.name}, ${item.passage ? 'for this line' : 'for the article'}`
              : `from a reader, ${item.passage ? 'for this line' : 'for your article'}`
          }
        />
        {item.passage ? (
          <blockquote className="qt-pocket__quote">{item.passage}</blockquote>
        ) : null}
        <p className="qt-pocket__article">
          {item.article.title}
          {item.article.href ? (
            <>
              {' '}
              <TextLink href={item.article.href} variant="standalone">
                Read more
              </TextLink>
            </>
          ) : null}
        </p>
        <dl className="qt-pocket__facts">
          <div>
            <dt>Status</dt>
            <dd>{words.long}</dd>
          </div>
          {detail?.paid && detail.unpaid ? (
            <div>
              <dt>{reader ? 'Paid so far' : 'Arrived so far'}</dt>
              <dd>
                {detail.paid} {reader ? 'reached the writer' : 'arrived'};{' '}
                {detail.unpaid}{' '}
                {item.reason === 'shortfall'
                  ? 'is waiting'
                  : reader
                    ? 'is back in your balance'
                    : 'did not complete'}
                .
              </dd>
            </div>
          ) : null}
          <div>
            <dt>When</dt>
            <dd>{whenLong(item.at)}</dd>
          </div>
          <div>
            <dt>{reader ? 'From' : 'To'}</dt>
            <dd>{reader ? 'Your balance' : 'Your earnings'}</dd>
          </div>
          {words.status === 'failed' ? null : (
            <div>
              <dt>Split</dt>
              <dd>
                {detail
                  ? `${reader ? 'The writer gets' : 'You get'} ${detail.net}. Quilltip keeps ${detail.fee}.`
                  : `${reader ? 'The writer gets' : 'You get'} 97.5%. Quilltip keeps 2.5%.`}
              </dd>
            </div>
          )}
          {detail?.tokenGross ? (
            <div>
              <dt>Exact amount</dt>
              <dd className="qt-pocket__token">{detail.tokenGross}</dd>
            </div>
          ) : null}
          {item.txHash ? (
            <div>
              <dt>Public record</dt>
              <dd>
                <TextLink href={recordHref(item.txHash)} external>
                  View on Stellar testnet
                </TextLink>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </Sheet>
  )
}
