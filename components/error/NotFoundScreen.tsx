'use client'

import { lazy, Suspense, useSyncExternalStore, type ReactNode } from 'react'
import { writerPathUsername } from '@/lib/routing/publicContentPath'

// The root 404 ships with every page, so load the writer screen (and the
// site header it carries) only when a writer URL is actually missing.
const AuthorNotFoundPage = lazy(() =>
  import('@/components/profile/AuthorNotFoundPage').then((mod) => ({
    default: mod.AuthorNotFoundPage,
  }))
)

const subscribe = () => () => {}
const getBrowserPath = () => window.location.pathname
const getServerPath = () => null

/**
 * The site 404 is prerendered, and Vercel serves it for every 404 the proxy
 * returns, so the server cannot know which URL was missing. After load, read
 * the address bar: an unknown writer gets the writer-not-found screen.
 */
export function NotFoundScreen({ fallback }: { fallback: ReactNode }) {
  const path = useSyncExternalStore(subscribe, getBrowserPath, getServerPath)
  const username = path ? writerPathUsername(path) : null
  return username ? (
    <Suspense fallback={fallback}>
      <AuthorNotFoundPage username={username} />
    </Suspense>
  ) : (
    fallback
  )
}
