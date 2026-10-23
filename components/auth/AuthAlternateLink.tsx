'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { appendNextToAuthPath } from '@/lib/profile/profileDestination'

interface AuthAlternateLinkProps {
  authPath: '/login' | '/register'
  prompt: string
  linkLabel: string
}

export function AuthAlternateLink({
  authPath,
  prompt,
  linkLabel,
}: AuthAlternateLinkProps) {
  const searchParams = useSearchParams()
  const href = appendNextToAuthPath(authPath, searchParams.get('next'))

  return (
    <p className="text-sm text-muted-foreground">
      {prompt}{' '}
      <Link
        href={href}
        className="font-medium text-primary hover:text-foreground transition-colors"
      >
        {linkLabel}
      </Link>
    </p>
  )
}
