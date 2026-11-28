import type { SheetDeclarations } from './types'

type Props = { intent?: unknown } | null | undefined

/** A short text an intent carries, or null. */
function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? value
    : null
}

/**
 * The sheet's title from its intent. The title is drawn before the sheet's
 * code loads, so it reads only the fields it shows, with the limits of
 * lib/auth/intent (kept out of the first load); the sheet itself checks
 * the whole intent and drops one that is not valid.
 */
function readTitle(props: Props): string {
  const intent = props?.intent as Record<string, unknown> | null | undefined
  if (!intent || typeof intent !== 'object') return 'Sign in to Quilltip'
  switch (intent.kind) {
    case 'tip': {
      const amount = intent.amount as Record<string, unknown> | null
      const shown = text(amount?.short, 16) ?? text(amount?.display, 16) ?? null
      if (!shown) break
      if (intent.passage) return `Tip this line ${shown}`
      const writer = text(intent.writer, 120)
      if (writer) return `Tip ${writer} ${shown}`
      break
    }
    case 'keep':
      return 'Keep this line'
    case 'draft':
      if (text(intent.draftId, 64)) return 'Save this draft'
      break
    case 'publish':
      if (text(intent.draftId, 64)) return 'Publish on Quilltip'
      break
    case 'follow': {
      const writer = text(intent.writer, 120)
      if (writer) return `Follow ${writer}`
      break
    }
  }
  return 'Sign in to Quilltip'
}

function title(props: Props): string {
  try {
    return readTitle(props)
  } catch {
    // A value whose reading throws is no intent.
    return 'Sign in to Quilltip'
  }
}

/** The signin package's lazily loaded sheets. Owned by that package. */
export const sheets: SheetDeclarations = {
  'sign-in': {
    title,
    load: () => import('@/components/signin/sheets/SignIn'),
  },
}
