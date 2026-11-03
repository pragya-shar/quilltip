import Link from 'next/link'
import { LandingOrnaments } from '@/components/landing/LandingOrnaments'
import { LandingWordmark } from '@/components/landing/LandingWordmark'

export function CollectionShell({
  children,
  isLibrary = false,
}: {
  children: React.ReactNode
  isLibrary?: boolean
}) {
  return (
    <div className="prototype-library" data-view="journal">
      <LandingOrnaments
        rootSelector=".prototype-library"
        count={15}
        trackContent
      />
      <header>
        <LandingWordmark />
        <nav aria-label="Main navigation">
          <Link href="/articles">Articles</Link>
          <Link href="/library" aria-current={isLibrary ? 'page' : undefined}>
            Your library
          </Link>
          <Link href="/write">Writing desk</Link>
        </nav>
      </header>
      {children}
    </div>
  )
}
