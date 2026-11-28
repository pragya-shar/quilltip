/**
 * `?screen=app`: a small app around the payments shell, with a feed, an
 * article with the passage tip and the balance screen, client navigation
 * and sign-in, inside an app-level boundary, to prove that payments
 * failures never take reading or navigation with them.
 */
import { BalanceScreenLive } from '../../../components/payments/BalanceScreenLive'
import { usePathname } from './navigation'
import { navigate } from './navigation'
import { controls } from './scenarios'
import type { ReactNode } from 'react'

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        navigate(href + location.search)
      }}
      style={{ marginInlineEnd: 12 }}
    >
      {children}
    </a>
  )
}

export function MiniApp({ article }: { article: ReactNode }) {
  const pathname = usePathname()
  return (
    <>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #ddd' }}>
        <nav aria-label="Main">
          <NavLink href="/articles">Articles</NavLink>
          <NavLink href="/balance">Balance</NavLink>
          <button type="button" onClick={() => controls.signIn('a')}>
            Sign in
          </button>{' '}
          <button type="button" onClick={() => controls.signOut()}>
            Sign out
          </button>
        </nav>
      </header>
      {pathname.startsWith('/article/') ? (
        article
      ) : pathname === '/balance' ? (
        <main style={{ padding: 16 }}>
          <BalanceScreenLive />
        </main>
      ) : (
        <main style={{ padding: 16 }}>
          <h1>Story time.</h1>
          <ul>
            <li>
              <NavLink href="/article/leave-it-overnight">
                Leave It Overnight
              </NavLink>
            </li>
          </ul>
        </main>
      )}
    </>
  )
}
