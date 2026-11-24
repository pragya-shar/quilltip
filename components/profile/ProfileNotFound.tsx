'use client'

import { useParams } from 'next/navigation'
import { AuthorNotFoundPage } from '@/components/profile/AuthorNotFoundPage'

/** 404 body for unknown writers; not-found files do not receive route params. */
export function ProfileNotFound() {
  const params = useParams<{ username?: string }>()
  return <AuthorNotFoundPage username={params?.username ?? ''} />
}
