import { parseIntent } from '@/lib/auth/intent'
import type { SheetDeclarations } from './types'

type Props = { intent?: unknown } | null | undefined

/** The sheet's title from its intent, as `parseIntent` reads it; anything
 * that is not a valid intent gets the plain title. */
function title(props: Props): string {
  const intent = parseIntent(props?.intent)
  switch (intent?.kind) {
    case 'tip': {
      const amount = intent.amount.short ?? intent.amount.display
      if (intent.passage) return `Tip this line ${amount}`
      return `Tip ${intent.writer} ${amount}`
    }
    case 'keep':
      return 'Keep this line'
    case 'draft':
      return 'Save this draft'
    case 'publish':
      return 'Publish on Quilltip'
    case 'follow':
      return `Follow ${intent.writer}`
    default:
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
