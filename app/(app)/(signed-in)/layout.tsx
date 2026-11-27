import type { ReactNode } from 'react'

/**
 * The signed-in segment. Pages that need an account live under this group.
 * Here, and only here and around enhancements beside the text, a
 * loading.tsx or Suspense boundary is allowed. The account guard
 * (`RequireAccount` on `authGate`, which arrives with pull request 578)
 * wraps children here; until then this layout passes them through.
 */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return children
}
