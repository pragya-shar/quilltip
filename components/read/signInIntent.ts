/**
 * What a signed-out reader was doing when they pressed Tip or Keep, kept
 * across sign-in. The sign-in package owns this contract
 * (`lib/auth/intent.ts` on `feat/sign-in-sheet`): the shapes, the key, the
 * stored form and `takeIntent` below mirror it exactly until that branch is
 * in this base; then this file re-exports its builders and resume hook.
 *
 * With a sign-in sheet the shell carries the intent (`openSignIn`). Without
 * one, and with no script, the link goes to the sign-in page with a
 * same-site return path that keeps the line's anchor; with scripts the
 * intent is also stored for this tab before leaving. On return the article
 * view takes it once: it chooses the line and sets the amount within the
 * ceiling, and sends nothing. Keeping it never acts on it.
 */

export type IntentPassage = { text: string; start: number; end: number }

/** An amount as the money layer wrote it: whole cents and its text. */
export type IntentAmount = { cents: number; display: string }

export type TipIntent = {
  kind: 'tip'
  /** Where the tip was pressed (a same-site path, with the line's anchor). */
  path: string
  articleId: string
  /** The chosen line, when the tip was for a line. */
  passage: IntentPassage | null
  /** The amount the button stated: a ceiling for the resumed tip. */
  amount: IntentAmount
  /** The writer's name, for the sheet's title. */
  writer: string
}

export type KeepIntent = {
  kind: 'keep'
  path: string
  articleId: string
  passage: IntentPassage
}

export type ReadIntent = TipIntent | KeepIntent

export const INTENT_KEY = 'quilltip:sign-in-intent'
export const INTENT_TTL_MS = 30 * 60_000
const INTENT_MAX_BYTES = 4096
const TEXT_MAX = 600
const ID_MAX = 64
const AMOUNT_MAX_CENTS = 50_00

/** A tip intent, as the sign-in package's `tipIntent` builds it. */
export function tipIntent(intent: Omit<TipIntent, 'kind'>): TipIntent {
  return { kind: 'tip', ...intent }
}

/** A keep intent, as the sign-in package's `keepIntent` builds it. */
export function keepIntent(intent: Omit<KeepIntent, 'kind'>): KeepIntent {
  return { kind: 'keep', ...intent }
}

/** The article's path, with the line's anchor when it has one. */
export function returnPathFor(articleHref: string, anchor: string | null) {
  return anchor ? `${articleHref}#${anchor}` : articleHref
}

/**
 * The sign-in page, returning to `returnTo` (a same-site path). The shell
 * will export one `signInHref`; this goes when it does.
 */
export function signInHref(returnTo: string) {
  return `/login?next=${encodeURIComponent(returnTo)}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const shortString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max
const isId = (value: unknown): value is string =>
  shortString(value, ID_MAX) && /^[A-Za-z0-9_-]+$/.test(value)
const isPath = (value: unknown): value is string =>
  shortString(value, 512) &&
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !/[\\\u0000-\u001f\u007f]/.test(value)

function passageOf(value: unknown): IntentPassage | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const { text, start, end } = value
  if (!shortString(text, TEXT_MAX)) return undefined
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined
  if ((start as number) < 0 || (end as number) <= (start as number))
    return undefined
  return { text, start: start as number, end: end as number }
}

function amountOf(value: unknown): IntentAmount | undefined {
  if (!isRecord(value)) return undefined
  const { cents, display } = value
  if (!Number.isInteger(cents)) return undefined
  if ((cents as number) <= 0 || (cents as number) > AMOUNT_MAX_CENTS)
    return undefined
  if (!shortString(display, 16)) return undefined
  return { cents: cents as number, display }
}

/** A stored value as a tip or keep intent, or null when anything is wrong. */
export function parseReadIntent(value: unknown): ReadIntent | null {
  if (!isRecord(value) || !isPath(value.path) || !isId(value.articleId))
    return null
  const passage = passageOf(value.passage)
  if (value.kind === 'tip') {
    const amount = amountOf(value.amount)
    if (passage === undefined || !amount || !shortString(value.writer, 120))
      return null
    return tipIntent({
      path: value.path,
      articleId: value.articleId,
      passage,
      amount,
      writer: value.writer,
    })
  }
  if (value.kind === 'keep' && passage)
    return keepIntent({
      path: value.path,
      articleId: value.articleId,
      passage,
    })
  return null
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Keeps an intent for after sign-in, in this tab. False when refused. */
export function saveIntent(intent: ReadIntent, now = Date.now()): boolean {
  const valid = parseReadIntent(intent)
  if (!valid) return false
  const text = JSON.stringify({ v: 1, savedAt: now, intent: valid })
  if (text.length > INTENT_MAX_BYTES) return false
  try {
    storage()?.setItem(INTENT_KEY, text)
    return true
  } catch {
    return false
  }
}

/**
 * The kept tip or keep intent for this page (`at`: path and hash), removed
 * once taken; null when there is none, it is for another page, or it is
 * malformed or expired.
 */
export function takeIntent(at: string, now = Date.now()): ReadIntent | null {
  const store = storage()
  let text: string | null = null
  try {
    text = store?.getItem(INTENT_KEY) ?? null
  } catch {
    return null
  }
  if (text === null || text.length > INTENT_MAX_BYTES) return null
  let stored: unknown
  try {
    stored = JSON.parse(text)
  } catch {
    return null
  }
  if (
    !isRecord(stored) ||
    stored.v !== 1 ||
    typeof stored.savedAt !== 'number' ||
    now - stored.savedAt < 0 ||
    now - stored.savedAt > INTENT_TTL_MS
  )
    return null
  const intent = parseReadIntent(stored.intent)
  if (!intent || intent.path !== at) return null
  try {
    store?.removeItem(INTENT_KEY)
  } catch {
    // Storage blocked: nothing more to clear.
  }
  return intent
}

/**
 * The amount a resumed tip starts at: the largest choice that does not
 * exceed the intent's ceiling, or null when none fits. Never raised.
 */
export function amountWithin(
  ceilingCents: number,
  choicesCents: readonly number[]
): number | null {
  let best: number | null = null
  for (const cents of choicesCents)
    if (cents <= ceilingCents && (best === null || cents > best)) best = cents
  return best
}
