import type { IconGlyph } from '@/system/components/Icon'
import { ShelfIcon, TodayIcon, WriteIcon } from '@/system/icons'

/**
 * The application's places, as data (D20: three places and a balance). The
 * phone bar and the desktop rail both render this; a change is one edit.
 *
 * The bar's fourth item is the balance, which is not a place: it opens the
 * Pocket over whatever the person is doing (see `POCKET`). Pushed screens
 * (articles, a shared line, a writer's page, search, the editor, You, the
 * line pager) have their own URLs and are not in the bar.
 *
 * While a place is still served by app/(legacy) (today `/` and `/write`),
 * following it is a full page load; auth, the payments outbox and the
 * remembered wallet live in storage and survive it.
 */
export type Place = {
  id: 'today' | 'shelf' | 'write'
  label: string
  href: string
  icon: IconGlyph
  /** exact: active only on href. prefix: on href and below it. */
  match: 'exact' | 'prefix'
}

export const PLACES: readonly Place[] = [
  { id: 'today', label: 'Today', href: '/', icon: TodayIcon, match: 'exact' },
  {
    id: 'shelf',
    label: 'Shelf',
    href: '/shelf',
    icon: ShelfIcon,
    match: 'prefix',
  },
  {
    id: 'write',
    label: 'Write',
    href: '/write',
    icon: WriteIcon,
    match: 'exact',
  },
]

/** The balance item: a sheet on a phone, a right panel on a desktop, and a
 * page for links and for a visitor with no script. */
export const POCKET = { href: '/pocket', signIn: '/login' } as const

function under(pathname: string, base: string): boolean {
  if (base === '/') return pathname === '/'
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** Whether a place is the current one. Pushed screens light no place. */
export function isActive(place: Place, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  return place.match === 'exact' ? path === place.href : under(path, place.href)
}
