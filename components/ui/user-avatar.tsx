'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { shownAvatar } from '@/lib/profile/shownAvatar'

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
  // A photo from another host shows the initials: no image element and no
  // request for it (#633).
  const shownSrc = shownAvatar(src)
  return (
    // An empty alt marks the avatar as decorative (a name sits beside it).
    <Avatar
      className={cn(className)}
      {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
    >
      {shownSrc ? <AvatarImage src={shownSrc} alt="" /> : null}
      <AvatarFallback
        className={cn(
          'bg-primary text-primary-foreground font-semibold text-sm',
          fallbackClassName
        )}
      >
        <span aria-hidden>{avatarInitials(name)}</span>
      </AvatarFallback>
    </Avatar>
  )
}
