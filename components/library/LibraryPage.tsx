'use client'
import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { buildRegisterHref } from '@/lib/auth/safeReturnPath'
import { AccountLibrary } from './AccountLibrary'
import { LibraryShell } from './LibraryShell'

export function LibraryPage() {
  const { user, isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!isLoading && !isAuthenticated)
      router.replace(buildRegisterHref('/library'))
  }, [isLoading, isAuthenticated, router])
  return (
    <LibraryShell>
      {!isLoading && isAuthenticated && user ? (
        <AccountLibrary key={user._id} userId={user._id} />
      ) : (
        <main className="collection-page">
          <p role="status">
            {isLoading
              ? 'Opening your library…'
              : 'Sign in or create an account to open your library.'}
          </p>
          {!isLoading && (
            <Link
              className="library-browse"
              href={buildRegisterHref('/library')}
            >
              Create an account ↗
            </Link>
          )}
        </main>
      )}
    </LibraryShell>
  )
}
