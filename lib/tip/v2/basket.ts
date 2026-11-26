/**
 * The tip basket (docs/architecture/v2/05-flows-and-admin.md, section 5.4):
 * up to 10 article or highlight tips paid in one `Core.tip_batch`, with at
 * most 24 transfers (each tip pays its recipients plus the platform fee).
 *
 * The basket is kept in this browser, per signed-in account. It holds only
 * what the reader chose; the server checks every item again when the basket
 * is prepared. Pure rules plus a tiny external store, with no payment code,
 * so the article page can show the basket button in its first load.
 */
import type { Id } from '@/convex/_generated/dataModel'

export const MAX_BASKET_ITEMS = 10
export const MAX_BASKET_TRANSFERS = 24

export type BasketHighlight = {
  text: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
}

export type BasketItem = {
  /** Local ID for keys and removal. */
  id: string
  articleId: string
  articleSlug: string
  articleTitle: string
  authorName: string
  amountCents: number
  highlight: BasketHighlight | null
  /** Recipients plus the fee, from `getTipEligibility().transferCount`. */
  transferCount: number
  /** `article_id` hex from `getTipEligibility`, checked before signing. */
  articleKey: string | null
}

export type BasketRefusal =
  | 'full_items'
  | 'full_transfers'
  | 'duplicate'
  | 'unavailable'
  | 'busy'

export type BasketCheck =
  | { ok: true }
  | { ok: false; reason: BasketRefusal; needed?: number; left?: number }

export function basketTransfers(items: readonly BasketItem[]): number {
  return items.reduce((sum, item) => sum + item.transferCount, 0)
}

function samePassage(a: BasketItem, b: Omit<BasketItem, 'id'>): boolean {
  if (a.articleId !== b.articleId) return false
  if (a.highlight === null || b.highlight === null) {
    return a.highlight === null && b.highlight === null
  }
  return (
    a.highlight.startOffset === b.highlight.startOffset &&
    a.highlight.endOffset === b.highlight.endOffset &&
    a.highlight.text === b.highlight.text
  )
}

/** Whether a tip can join the basket, and why not. */
export function canAddToBasket(
  items: readonly BasketItem[],
  candidate: Omit<BasketItem, 'id'>,
  options: { busy?: boolean } = {}
): BasketCheck {
  if (options.busy) return { ok: false, reason: 'busy' }
  if (
    !Number.isSafeInteger(candidate.transferCount) ||
    candidate.transferCount < 2
  ) {
    return { ok: false, reason: 'unavailable' }
  }
  if (items.some((item) => samePassage(item, candidate))) {
    return { ok: false, reason: 'duplicate' }
  }
  if (items.length >= MAX_BASKET_ITEMS) {
    return { ok: false, reason: 'full_items' }
  }
  const left = MAX_BASKET_TRANSFERS - basketTransfers(items)
  if (candidate.transferCount > left) {
    return {
      ok: false,
      reason: 'full_transfers',
      needed: candidate.transferCount,
      left,
    }
  }
  return { ok: true }
}

/** The `prepareBatch` items, in basket order. */
export function batchRequest(items: readonly BasketItem[]) {
  return items.map((item) => ({
    articleId: item.articleId as Id<'articles'>,
    amountCents: item.amountCents,
    ...(item.highlight
      ? {
          highlight: {
            text: item.highlight.text,
            startOffset: item.highlight.startOffset,
            endOffset: item.highlight.endOffset,
            ...(item.highlight.startContainerPath
              ? { startContainerPath: item.highlight.startContainerPath }
              : {}),
            ...(item.highlight.endContainerPath
              ? { endContainerPath: item.highlight.endContainerPath }
              : {}),
          },
        }
      : {}),
  }))
}

// ---------------------------------------------------------------------------
// Store

export type BasketState = {
  items: BasketItem[]
  /** The basket payment in flight or with a result to show, if any. */
  submissionId: string | null
  /** Items as sent, so the result can name them after the basket clears. */
  sent: BasketItem[] | null
}

const EMPTY: BasketState = { items: [], submissionId: null, sent: null }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function keyFor(owner: string): string {
  return `quilltip:tip-basket:v2:${owner}`
}

function isItem(value: unknown): value is BasketItem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.articleId === 'string' &&
    typeof v.articleSlug === 'string' &&
    typeof v.articleTitle === 'string' &&
    typeof v.authorName === 'string' &&
    typeof v.amountCents === 'number' &&
    typeof v.transferCount === 'number' &&
    (v.highlight === null ||
      (typeof v.highlight === 'object' &&
        typeof (v.highlight as BasketHighlight).text === 'string' &&
        typeof (v.highlight as BasketHighlight).startOffset === 'number' &&
        typeof (v.highlight as BasketHighlight).endOffset === 'number'))
  )
}

/** Reads a stored basket; anything malformed reads as empty. */
export function parseBasket(raw: string | null): BasketState {
  if (!raw) return EMPTY
  try {
    const value = JSON.parse(raw) as Partial<BasketState>
    const items = Array.isArray(value.items)
      ? value.items.filter(isItem).slice(0, MAX_BASKET_ITEMS)
      : []
    const sent = Array.isArray(value.sent) ? value.sent.filter(isItem) : null
    return {
      items,
      submissionId:
        typeof value.submissionId === 'string' ? value.submissionId : null,
      sent,
    }
  } catch {
    return EMPTY
  }
}

type Listener = () => void

/**
 * One basket per signed-in account in this browser, shared by every tip
 * surface on the page and kept in step across tabs through `storage` events.
 */
export class BasketStore {
  private state: BasketState = EMPTY
  private owner: string | null = null
  private listeners = new Set<Listener>()
  private store: StorageLike | null

  constructor(store: StorageLike | null = storage()) {
    this.store = store
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (this.owner && event.key === keyFor(this.owner)) this.load()
      })
    }
  }

  setOwner(owner: string | null): void {
    if (owner === this.owner) return
    this.owner = owner
    this.load()
  }

  private load(): void {
    this.state = this.owner
      ? parseBasket(this.store?.getItem(keyFor(this.owner)) ?? null)
      : EMPTY
    this.emit()
  }

  private save(next: BasketState): void {
    this.state = next
    if (this.owner) {
      try {
        if (next.items.length === 0 && !next.submissionId) {
          this.store?.removeItem(keyFor(this.owner))
        } else {
          this.store?.setItem(keyFor(this.owner), JSON.stringify(next))
        }
      } catch {
        // Storage full or blocked: the basket still works for this page.
      }
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): BasketState => this.state

  /** Adds a tip when the rules allow it. */
  add(candidate: Omit<BasketItem, 'id'>): BasketCheck {
    if (!this.owner) return { ok: false, reason: 'unavailable' }
    const check = canAddToBasket(this.state.items, candidate, {
      busy: this.state.submissionId !== null,
    })
    if (!check.ok) return check
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.save({
      ...this.state,
      items: [...this.state.items, { ...candidate, id }],
    })
    return check
  }

  remove(id: string): void {
    this.save({
      ...this.state,
      items: this.state.items.filter((item) => item.id !== id),
    })
  }

  setAmount(id: string, amountCents: number): void {
    this.save({
      ...this.state,
      items: this.state.items.map((item) =>
        item.id === id ? { ...item, amountCents } : item
      ),
    })
  }

  clear(): void {
    this.save({ ...this.state, items: [] })
  }

  /** The basket was prepared; it stays locked until the result is known. */
  startPayment(submissionId: string): void {
    this.save({ ...this.state, submissionId, sent: this.state.items })
  }

  /**
   * The payment reached a final state. When money moved (confirmed, sent to
   * an updated address, under review) the sent items leave the basket; after
   * FAILED or EXPIRED they stay, so the reader can try again.
   */
  finishPayment(paid: boolean): void {
    const sentIds = new Set((this.state.sent ?? []).map((item) => item.id))
    this.save({
      items: paid
        ? this.state.items.filter((item) => !sentIds.has(item.id))
        : this.state.items,
      submissionId: null,
      sent: null,
    })
  }
}

let shared: BasketStore | null = null

/** The page's basket store. */
export function basketStore(): BasketStore {
  shared ??= new BasketStore()
  return shared
}
