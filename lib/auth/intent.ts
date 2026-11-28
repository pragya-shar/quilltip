import { sameSitePath } from './returnPath'
import { isSigningOut } from '@/shell/signOut/state'

/**
 * What a person was doing when they were asked to sign in (a tip, a kept
 * line, a publish, a follow), kept across the sign-in so the page can show
 * it again. Keeping it never acts on it:
 * after sign-in the surface shows the intent ready, and a tip still needs
 * its own press. An intent's amount is a ceiling: a resumed tip may be
 * smaller, never larger. Account creation never sends money.
 *
 * The contract:
 * - Build an intent only with `tipIntent`, `keepIntent`, `publishIntent` or
 *   `followIntent`; each checks its input and returns null when it is wrong.
 *   `openSignIn` takes only what they return.
 * - After sign-in, the surface that owns the intent's kind takes it back on
 *   the intent's own page with `useResumedIntent(kind)`
 *   (hooks/auth/useResumedIntent), once, and restores its own state.
 *
 * Stored in this tab only (sessionStorage), so it survives a full page
 * load; validated on every read, bounded in size, and dropped after
 * INTENT_TTL_MS.
 */

/** A chosen line, with the stored offsets (the money layer's `PassageRef`
 * names). */
export type IntentPassage = {
  text: string
  startOffset: number
  endOffset: number
}

/** An amount as the money layer wrote it: whole cents, its text, and its
 * short text for a button ("$1"), when it has one. */
export type IntentAmount = { cents: number; display: string; short?: string }

declare const BUILT: unique symbol
/** Made by this module's builders or parser, never by hand. */
type Built = { readonly [BUILT]: true }

export type SignInIntent = Built &
  (
    | {
        kind: 'tip'
        /** Where the tip was pressed (a same-site path). */
        path: string
        articleId: string
        /** The chosen line, when the tip was for a line. */
        passage: IntentPassage | null
        /** The amount the button stated: a ceiling for the resumed tip. */
        amount: IntentAmount
        /** The writer's name, for the sheet's title. */
        writer: string
      }
    | {
        kind: 'keep'
        path: string
        articleId: string
        passage: IntentPassage
      }
    | {
        kind: 'publish'
        path: string
        draftId: string
      }
    | {
        kind: 'follow'
        path: string
        writerId: string
        /** The writer's name, for the sheet's title. */
        writer: string
      }
  )

type Fields<K extends SignInIntent['kind']> = Omit<
  Extract<SignInIntent, { kind: K }>,
  'kind' | typeof BUILT
>

export const INTENT_KEY = 'quilltip:sign-in-intent'
export const INTENT_TTL_MS = 30 * 60_000
/** Larger than any real intent; anything bigger is refused. */
export const INTENT_MAX_BYTES = 4096
const TEXT_MAX = 600
const ID_MAX = 64
/** The largest tip a resumed intent may carry, in cents. */
const AMOUNT_MAX_CENTS = 50_00

type Stored = { v: 1; savedAt: number; intent: SignInIntent }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const shortString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

const id = (value: unknown): value is string =>
  shortString(value, ID_MAX) && /^[A-Za-z0-9_-]+$/.test(value)

function passage(value: unknown): IntentPassage | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const { text, startOffset: start, endOffset: end } = value
  if (!shortString(text, TEXT_MAX)) return undefined
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined
  if ((start as number) < 0 || (end as number) <= (start as number))
    return undefined
  return { text, startOffset: start as number, endOffset: end as number }
}

function amount(value: unknown): IntentAmount | undefined {
  if (!isRecord(value)) return undefined
  const { cents, display, short } = value
  if (!Number.isInteger(cents)) return undefined
  if ((cents as number) <= 0 || (cents as number) > AMOUNT_MAX_CENTS)
    return undefined
  if (!shortString(display, 16)) return undefined
  if (short !== undefined && !shortString(short, 16)) return undefined
  return short === undefined
    ? { cents: cents as number, display }
    : { cents: cents as number, display, short }
}

function path(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const safe = sameSitePath(value, '')
  return safe === '' ? undefined : safe
}

const built = (intent: object) => intent as SignInIntent

/** A stored value as an intent, or null when anything about it is wrong. */
export function parseIntent(value: unknown): SignInIntent | null {
  if (!isRecord(value)) return null
  const at = path(value.path)
  if (!at) return null
  switch (value.kind) {
    case 'tip': {
      const line = passage(value.passage)
      const ceiling = amount(value.amount)
      if (line === undefined || !ceiling || !id(value.articleId)) return null
      if (!shortString(value.writer, 120)) return null
      return built({
        kind: 'tip',
        path: at,
        articleId: value.articleId,
        passage: line,
        amount: ceiling,
        writer: value.writer,
      })
    }
    case 'keep': {
      const line = passage(value.passage)
      if (!line || !id(value.articleId)) return null
      return built({
        kind: 'keep',
        path: at,
        articleId: value.articleId,
        passage: line,
      })
    }
    case 'publish':
      if (!id(value.draftId)) return null
      return built({ kind: 'publish', path: at, draftId: value.draftId })
    case 'follow':
      if (!id(value.writerId) || !shortString(value.writer, 120)) return null
      return built({
        kind: 'follow',
        path: at,
        writerId: value.writerId,
        writer: value.writer,
      })
    default:
      return null
  }
}

/** A tip the person pressed: on a line (`passage`) or on the article. */
export const tipIntent = (fields: Fields<'tip'>) =>
  parseIntent({ ...fields, kind: 'tip' }) as Extract<
    SignInIntent,
    { kind: 'tip' }
  > | null
/** A line the person wanted to keep. */
export const keepIntent = (fields: Fields<'keep'>) =>
  parseIntent({ ...fields, kind: 'keep' }) as Extract<
    SignInIntent,
    { kind: 'keep' }
  > | null
/** A draft the person wanted to publish. */
export const publishIntent = (fields: Fields<'publish'>) =>
  parseIntent({ ...fields, kind: 'publish' }) as Extract<
    SignInIntent,
    { kind: 'publish' }
  > | null
/** A writer the person wanted to follow. */
export const followIntent = (fields: Fields<'follow'>) =>
  parseIntent({ ...fields, kind: 'follow' }) as Extract<
    SignInIntent,
    { kind: 'follow' }
  > | null

/** The path part of a same-site path, for matching a page. */
function pageOf(path: string): string {
  const cut = path.search(/[?#]/)
  return cut === -1 ? path : path.slice(0, cut)
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Where the shell keeps its signed-in marker (shell/signOut/state.ts). */
function markerStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Keeps an intent for after sign-in. Refused (false) when it is invalid,
 * too large, or the person is signing out. */
export function saveIntent(
  intent: SignInIntent | unknown,
  now = Date.now()
): boolean {
  if (isSigningOut(markerStorage())) return false
  const valid = parseIntent(intent)
  if (!valid) return false
  const text = JSON.stringify({ v: 1, savedAt: now, intent: valid } as Stored)
  if (text.length > INTENT_MAX_BYTES) return false
  try {
    storage()?.setItem(INTENT_KEY, text)
    return true
  } catch {
    return false
  }
}

/** The kept intent, if it is valid and not expired; anything else is
 * cleared. */
export function readIntent(now = Date.now()): SignInIntent | null {
  const store = storage()
  let text: string | null = null
  try {
    text = store?.getItem(INTENT_KEY) ?? null
  } catch {
    return null
  }
  if (text === null) return null
  let stored: unknown
  try {
    stored =
      text.length > INTENT_MAX_BYTES ? null : (JSON.parse(text) as unknown)
  } catch {
    stored = null
  }
  const intent =
    isRecord(stored) &&
    stored.v === 1 &&
    typeof stored.savedAt === 'number' &&
    now - stored.savedAt >= 0 &&
    now - stored.savedAt <= INTENT_TTL_MS
      ? parseIntent(stored.intent)
      : null
  if (!intent) clearIntent()
  return intent
}

/** The kept intent of this kind for this page (its path, whatever the
 * query), removed once taken. One for another page or kind stays. */
export function takeIntent<K extends SignInIntent['kind']>(
  kind: K,
  at: string,
  now = Date.now()
): Extract<SignInIntent, { kind: K }> | null {
  const intent = readIntent(now)
  if (!intent || intent.kind !== kind || pageOf(intent.path) !== pageOf(at))
    return null
  clearIntent()
  return intent as Extract<SignInIntent, { kind: K }>
}

export function clearIntent() {
  try {
    storage()?.removeItem(INTENT_KEY)
  } catch {
    // Storage blocked: nothing was kept.
  }
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
