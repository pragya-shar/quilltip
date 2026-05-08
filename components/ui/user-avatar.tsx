'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export function avatarInitials(name: string): string {
  const n = name.trim()
  if (!n) return '?'
  return n.charAt(0).toUpperCase()
}

export interface UserAvatarProps {
  src?: string | null
  alt: string
  name: string
  className?: string
  fallbackClassName?: string
}

export function UserAvatar({
  src,
  alt,
  name,
  className,
  fallbackClassName,
}: UserAvatarProps) {
  const trimmedSrc = src?.trim()
  return (
    <Avatar className={cn(className)} role="img" aria-label={alt}>
      {trimmedSrc ? <AvatarImage src={trimmedSrc} alt="" /> : null}
      <AvatarFallback
        className={cn(
          'bg-brand-blue text-white font-semibold text-sm',
          fallbackClassName
        )}
      >
        <span aria-hidden>{avatarInitials(name)}</span>
      </AvatarFallback>
    </Avatar>
  )
}
