import type { IconGlyph } from '@/system/components/Icon'
import {
  BalanceIcon,
  ReadIcon,
  SearchIcon,
  WriteIcon,
  YouIcon,
} from '@/system/icons'

/**
 * The application's navigation, as data. The phone bar and the desktop
 * rail both render this list; changing a destination is one edit here.
 *
 * Status: placeholder. The structure comes from the approved "Marker"
 * design until the design session's milestone M1 fixes the product's
 * structure; M1 replaces this list. Hrefs are the final public URLs. While
 * a destination is still served by app/(legacy), following it is a full
 * page load (two root layouts); auth, the payments outbox and the
 * remembered wallet survive it because they live in storage.
 */
export type Destination = {
  id: string
  label: string
  href: string
  icon: IconGlyph
  /** Where it appears. The phone bar holds at most five. */
  on: readonly ('phone' | 'desktop')[]
  /** prefix: active on any path under href. exact: only on href. */
  match: 'exact' | 'prefix'
  /** Paths that also make it active (aliases, nested routes elsewhere). */
  also?: readonly string[]
  /** A live figure beside the label (the balance). */
  figure?: 'balance'
}

export type Navigation = {
  status: 'placeholder' | 'final'
  destinations: readonly Destination[]
  /** The rail's one filled action on desktop. */
  primary: { label: string; href: string; icon: IconGlyph } | null
}

export const NAVIGATION: Navigation = {
  status: 'placeholder',
  destinations: [
    {
      id: 'read',
      label: 'Read',
      href: '/',
      icon: ReadIcon,
      on: ['phone', 'desktop'],
      match: 'exact',
    },
    {
      id: 'search',
      label: 'Search',
      href: '/articles',
      icon: SearchIcon,
      on: ['desktop'],
      match: 'exact',
    },
    {
      id: 'write',
      label: 'Write',
      href: '/write',
      icon: WriteIcon,
      on: ['phone'],
      match: 'prefix',
    },
    {
      id: 'balance',
      label: 'Balance',
      href: '/dashboard/tab',
      icon: BalanceIcon,
      on: ['phone', 'desktop'],
      match: 'prefix',
      figure: 'balance',
    },
    {
      id: 'you',
      label: 'You',
      href: '/dashboard/stats',
      icon: YouIcon,
      on: ['phone', 'desktop'],
      match: 'prefix',
      also: ['/settings', '/library'],
    },
  ],
  primary: { label: 'Write', href: '/write', icon: WriteIcon },
}

export function destinationsFor(
  nav: Navigation,
  place: 'phone' | 'desktop'
): Destination[] {
  return nav.destinations.filter((d) => d.on.includes(place))
}

function under(pathname: string, base: string): boolean {
  if (base === '/') return pathname === '/'
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** Whether a destination is the current place. */
export function isActive(destination: Destination, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (destination.also?.some((alias) => under(path, alias))) return true
  return destination.match === 'exact'
    ? path === destination.href
    : under(path, destination.href)
}
