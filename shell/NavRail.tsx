'use client'

import Link from 'next/link'
import { prefetchFor } from '@/lib/routing/legacyRoutes'
import { usePathname } from 'next/navigation'
import { Icon } from '@/system/components/Icon'
import { BalanceItem } from './BalanceItem'
import { PLACES, isActive } from './navigation'
import { NavPending } from './NavPending'

/** The desktop rail: the wordmark, the same four items as the phone bar. */
export function NavRail() {
  const pathname = usePathname() ?? '/'
  return (
    <nav className="qt-rail" aria-label="Main">
      <Link href="/" prefetch={prefetchFor('/')} className="qt-rail__wordmark">
        Quilltip
      </Link>
      <ul className="qt-rail__list">
        {PLACES.map((place) => (
          <li key={place.id}>
            <Link
              href={place.href}
              prefetch={prefetchFor(place.href)}
              className="qt-rail__item"
              aria-current={isActive(place, pathname) ? 'page' : undefined}
            >
              <Icon icon={place.icon} size={24} />
              <span className="qt-nav__label">{place.label}</span>
              <NavPending />
            </Link>
          </li>
        ))}
        <li className="qt-rail__balance">
          <BalanceItem className="qt-rail__item" />
        </li>
      </ul>
    </nav>
  )
}
