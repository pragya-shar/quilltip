import type { ReactNode } from 'react'
import Link from 'next/link'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { LandingOrnaments } from '@/components/landing/LandingOrnaments'

export function ReadingRoomShell({ children }: { children: ReactNode }) {
  return (
    <div className="reading-room">
      <LandingOrnaments rootSelector=".reading-room" count={15} />
      <header className="reading-room-header">
        <LandingWordmark />
        <nav aria-label="Main navigation">
          <Link href="/articles" aria-current="page">
            Articles
          </Link>
          <Link href="/library">Your library</Link>
          <Link href="/write">Writing desk</Link>
        </nav>
      </header>
      {children}
    </div>
  )
}
