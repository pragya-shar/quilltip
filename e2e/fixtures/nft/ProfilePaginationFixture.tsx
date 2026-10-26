import { useState } from 'react'
import { ProfileNftsTabContent } from '../../../components/profile/ProfileNftsTabContent'
import type { Id } from '../../../types/convex'
import { ProfileNftTotalsContext } from './runtime'

export function ProfilePaginationFixture() {
  const params = new URLSearchParams(location.search)
  const [total, setTotal] = useState(Number(params.get('total') ?? 9))
  return (
    <main className="profile-page min-h-screen">
      <div className="profile-folio">
        <button
          onClick={() => document.documentElement.classList.toggle('dark')}
        >
          Toggle theme
        </button>
        <button
          onClick={() => {
            const next = new URL(location.href)
            next.searchParams.set('total', '9')
            history.replaceState(null, '', next)
            setTotal(9)
          }}
        >
          Shrink collections to 9
        </button>
        <ProfileNftTotalsContext.Provider value={total}>
          <ProfileNftsTabContent
            userId={'qa-author' as Id<'users'>}
            username="writer"
            nftOwnedPage={Number(params.get('nftOwnedPage') ?? 1)}
            nftMintedPage={Number(params.get('nftMintedPage') ?? 1)}
            isOwnProfile={false}
            displayName="Writer"
          />
        </ProfileNftTotalsContext.Provider>
      </div>
    </main>
  )
}
