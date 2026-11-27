'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/system/components/Icon'
import { NAVIGATION, destinationsFor, isActive } from './navigation'
import { NavPending } from './NavPending'

/** The desktop navigation: a rail with the wordmark, places and one action. */
export function NavRail() {
  const pathname = usePathname() ?? '/'
  const items = destinationsFor(NAVIGATION, 'desktop')
  const primary = NAVIGATION.primary
  return (
    <nav className="qt-rail" aria-label="Main">
      <Link href="/" className="qt-rail__wordmark">
        Quilltip
      </Link>
      <ul className="qt-rail__list">
        {items.map((item) => {
          const active = isActive(item, pathname)
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="qt-rail__item"
                aria-current={active ? 'page' : undefined}
              >
                <Icon icon={item.icon} size={24} />
                <span>{item.label}</span>
                <NavPending />
              </Link>
            </li>
          )
        })}
      </ul>
      {primary ? (
        <Link
          href={primary.href}
          className="qt-button qt-rail__primary"
          data-variant="primary"
          data-size="m"
          data-block=""
        >
          <Icon icon={primary.icon} size={20} />
          <span className="qt-button__label">{primary.label}</span>
        </Link>
      ) : null}
    </nav>
  )
}
