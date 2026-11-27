/**
 * Remembers which v2 tip a tip surface started, so a reload resumes from
 * the server record (`tipsV2.getTipStatus`). Only the submission ID and,
 * once `sendTransaction` accepted the envelope, its hash are kept; the
 * server record decides everything else.
 *
 * If the page closes after the send and before `recordSubmitted`, the next
 * load records the stored hash (a repeat is free on the server). Without a
 * hash the record stays `PREPARED` and the indexer confirms it from the
 * event, or it expires (06-app-integration.md, section 6.1).
 */
export type PendingTip = {
  submissionId: string
  /** Set once the transaction was sent. */
  txHash: string | null
  /** Unix ms. */
  startedAt: number
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function local(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Kept for a week, the RPC retention window; older entries are dropped. */
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** The storage key of one tip surface for one account. */
export function pendingKey(owner: string, scope: string): string {
  return `quilltip:tip-pending:v2:${owner}:${scope}`
}

/** Scope of the article tip on an article. */
export function articleScope(articleId: string): string {
  return `article:${articleId}`
}

/** Scope of a highlight tip: the article and the passage offsets. */
export function highlightScope(
  articleId: string,
  startOffset: number,
  endOffset: number
): string {
  return `highlight:${articleId}:${startOffset}:${endOffset}`
}

export function parsePending(
  raw: string | null,
  now: number = Date.now()
): PendingTip | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PendingTip>
    if (
      typeof value.submissionId !== 'string' ||
      !value.submissionId ||
      typeof value.startedAt !== 'number' ||
      now - value.startedAt > PENDING_TTL_MS
    ) {
      return null
    }
    return {
      submissionId: value.submissionId,
      txHash:
        typeof value.txHash === 'string' && /^[0-9a-f]{64}$/.test(value.txHash)
          ? value.txHash
          : null,
      startedAt: value.startedAt,
    }
  } catch {
    return null
  }
}

export function readPending(
  key: string,
  store: StorageLike | null = local()
): PendingTip | null {
  try {
    return parsePending(store?.getItem(key) ?? null)
  } catch {
    return null
  }
}

export function writePending(
  key: string,
  value: PendingTip,
  store: StorageLike | null = local()
): void {
  try {
    store?.setItem(key, JSON.stringify(value))
  } catch {
    // Blocked storage: the flow still works; a reload cannot resume it.
  }
}

export function clearPending(
  key: string,
  store: StorageLike | null = local()
): void {
  try {
    store?.removeItem(key)
  } catch {
    // Nothing to do.
  }
}
