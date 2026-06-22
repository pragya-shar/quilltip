'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'
import { handleLandingHashClick } from '@/lib/landing/scroll-to-section'

type LandingHashLinkProps = ComponentProps<typeof Link>

export function LandingHashLink({
  href,
  onClick,
  ...props
}: LandingHashLinkProps) {
  const hrefString = typeof href === 'string' ? href : ''

  return (
    <Link
      href={href}
      {...props}
      onClick={(e) => {
        if (hrefString.startsWith('#')) {
          handleLandingHashClick(e, hrefString)
        }
        onClick?.(e)
      }}
    />
  )
}
