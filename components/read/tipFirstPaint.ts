import { formatMoney } from '@/lib/payments/money'
import { articleIdOf } from '@/lib/payments/target'
import type { Money } from '@/lib/payments/types'

/**
 * What the server knows of the tip bar before any script: whether this id
 * can take a tip control at all, and the amount the button states first.
 * Plain data, so the bar draws its first paint with no payments code; the
 * money layer replaces it once its code has loaded. Import this module from
 * server code only (ArticleView): it reads the layer's money and target
 * helpers, which never belong in a first load. Client code imports its type.
 */
export type TipFirstPaint = {
  /** False for an id that is not a document id: no tip control at all. */
  control: boolean
  /** The amount the button states before the layer answers ("$1.00"),
   * and the same in the layer's short form for the button ("$1"). */
  amount: Money
  short: Money
}

/**
 * The default the money layer's controller states before its engine has
 * computed one ($1). A signed-in reader whose default is $1 and who has
 * enough balance sees the same words before and after the layer loads.
 */
const FIRST_PAINT_CENTS = 100

export function tipFirstPaint(articleId: string): TipFirstPaint {
  return {
    control: articleIdOf(articleId) !== null,
    amount: {
      cents: FIRST_PAINT_CENTS,
      display: formatMoney(FIRST_PAINT_CENTS),
    },
    short: {
      cents: FIRST_PAINT_CENTS,
      display: formatMoney(FIRST_PAINT_CENTS, { short: true }),
    },
  }
}
