import { useState } from 'react'
import { ProfileNftsTabContent } from '../../../components/profile/ProfileNftsTabContent'
import type { Id } from '../../../types/convex'
import { ProfileNftQueriesContext } from './runtime'
import { useSearchParams } from './navigation'

export function ProfilePaginationFixture() {
  const params = useSearchParams()
  const ownedPage = Number(params.get('nftOwnedPage') ?? 1)
  const mintedPage = Number(params.get('nftMintedPage') ?? 1)
  const [queries, setQueries] = useState(() => ({
    owned: { total: Number(params.get('total') ?? 9), resolvedPage: ownedPage },
    minted: {
      total: Number(params.get('total') ?? 9),
      resolvedPage: mintedPage,
    },
  }))
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
            setQueries((previous) => ({
              owned: { ...previous.owned, total: 9 },
              minted: { ...previous.minted, total: 9 },
            }))
          }}
        >
          Shrink collections to 9
        </button>
        {params.get('controlled') === '1' &&
          (['owned', 'minted'] as const).map((collection) => (
            <div key={collection}>
              <button
                onClick={() =>
                  setQueries((previous) => ({
                    ...previous,
                    [collection]: {
                      ...previous[collection],
                      resolvedPage:
                        collection === 'owned' ? ownedPage : mintedPage,
                    },
                  }))
                }
              >
                Resolve {collection} page
              </button>
              <button
                onClick={() =>
                  setQueries((previous) => ({
                    ...previous,
                    [collection]: {
                      total: 9,
                      resolvedPage:
                        collection === 'owned' ? ownedPage : mintedPage,
                    },
                  }))
                }
              >
                Resolve {collection} empty page
              </button>
            </div>
          ))}
        <ProfileNftQueriesContext.Provider value={queries}>
          <ProfileNftsTabContent
            userId={'qa-author' as Id<'users'>}
            username="writer"
            nftOwnedPage={ownedPage}
            nftMintedPage={mintedPage}
            isOwnProfile={false}
            displayName="Writer"
          />
        </ProfileNftQueriesContext.Provider>
      </div>
    </main>
  )
}
