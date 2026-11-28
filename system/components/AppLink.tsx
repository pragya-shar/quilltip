'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type {
  ComponentProps,
  FocusEvent,
  PointerEvent,
  TouchEvent,
} from 'react'
import { linkPrefetch } from '@/lib/routing/legacyRoutes'

type AppLinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & {
  href: string
  /** false: never prefetch. Without it, the shell's rule decides. */
  prefetch?: false
}

/**
 * Every link of the shell and the design system. The shell decides how it
 * prefetches (`linkPrefetch` in lib/routing/legacyRoutes.ts): never a
 * legacy page; a writer's page or an article only on intent (pointer over,
 * touch start, focus), because each prefetch runs the proxy's route check;
 * the shell's own places as Next.js does.
 */
export function AppLink({
  href,
  prefetch,
  onPointerEnter,
  onTouchStart,
  onFocus,
  ...rest
}: AppLinkProps) {
  const router = useRouter()
  const policy = prefetch === false ? 'never' : linkPrefetch(href)
  const intent = () => {
    if (policy === 'intent') router.prefetch(href)
  }
  return (
    <Link
      {...rest}
      href={href}
      prefetch={policy === 'default' ? undefined : false}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        intent()
        onPointerEnter?.(event)
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        intent()
        onTouchStart?.(event)
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        intent()
        onFocus?.(event)
      }}
    />
  )
}
