import Link from 'next/link'
import { LandingWordmark } from '@/components/landing/LandingWordmark'

export function LibraryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="prototype-library" data-view="journal">
      <header>
        <LandingWordmark />
        <nav aria-label="Main navigation">
          <Link href="/articles">Articles</Link>
          <Link href="/library" aria-current="page">
            Your library
          </Link>
          <Link href="/write">Writing desk</Link>
        </nav>
      </header>
      {children}
    </div>
  )
}
