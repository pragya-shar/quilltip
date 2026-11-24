'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { AuthorNotFoundPage } from '@/components/profile/AuthorNotFoundPage'
import { writerPathUsername } from '@/lib/routing/publicContentPath'

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
  return username ? <AuthorNotFoundPage username={username} /> : fallback
}
