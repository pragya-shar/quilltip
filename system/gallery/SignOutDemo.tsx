'use client'

import { SignOutControl } from '@/shell/signOut/SignOutControl'
import type { SignOutWarning } from '@/shell/signOut'
import { showToast } from '../toast'

const STRANDED: readonly SignOutWarning[] = [
  {
    name: 'device drafts',
    check: async () => '2 drafts are only on this device.',
  },
  { name: 'nothing to say', check: async () => null },
]

const BROKEN: readonly SignOutWarning[] = [
  {
    name: 'fails',
    check: async () => {
      throw new Error('no answer')
    },
  },
  {
    name: 'late',
    check: () =>
      new Promise((resolve) => setTimeout(() => resolve('Late.'), 5000)),
  },
]

/** Sign-out with a warning, and with checks that fail or run late. Nothing
 * signs anyone out: the gallery's sign-out only shows a toast. */
export function SignOutDemo({ broken = false }: { broken?: boolean }) {
  return (
    <SignOutControl
      signOut={async () => {}}
      onSignedOut={() =>
        showToast({
          title: broken
            ? 'Signed out (gallery), no checks answered'
            : 'Signed out (gallery)',
        })
      }
      warnings={broken ? BROKEN : STRANDED}
      limitMs={300}
    />
  )
}
