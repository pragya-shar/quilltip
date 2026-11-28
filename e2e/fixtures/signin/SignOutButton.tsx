import { useSignOut } from '../../../hooks/auth/useSignOut'

// Stands in for the You surface's sign-out row.
export function SignOutButton() {
  const signOut = useSignOut()
  return (
    <button
      type="button"
      className="qt-button"
      data-variant="secondary"
      data-fixture="sign-out"
      onClick={() => void signOut()}
    >
      <span className="qt-button__label">Sign out</span>
    </button>
  )
}
