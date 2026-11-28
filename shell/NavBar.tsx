'use client'

import { AppLink as Link } from '@/system/components/AppLink'
import { usePathname } from 'next/navigation'
import { Icon } from '@/system/components/Icon'
import { BalanceItem } from './BalanceItem'
import { PLACES, isActive } from './navigation'
import { NavPending } from './NavPending'

/**
 * The phone bar: Today, Shelf, Write and the balance, floating in thumb
 * reach above the home indicator and a wallet browser's toolbar. Real links
 * in the server HTML, so it works before scripts load. Hidden on pushed
 * screens and while the on-screen keyboard is up (shell.css).
 */
export function NavBar() {
  const pathname = usePathname() ?? '/'
  return (
    <nav className="qt-navbar" aria-label="Main">
      <ul className="qt-navbar__list">
        {PLACES.map((place) => (
          <li key={place.id}>
            <Link
              href={place.href}
              className="qt-navbar__item"
              aria-current={isActive(place, pathname) ? 'page' : undefined}
            >
              <Icon icon={place.icon} size={24} />
              <span className="qt-nav__label">{place.label}</span>
              <NavPending />
            </Link>
          </li>
        ))}
        <li>
          <BalanceItem className="qt-navbar__item" />
        </li>
      </ul>
    </nav>
  )
}
