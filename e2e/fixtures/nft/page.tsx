import { createRoot } from 'react-dom/client'
import { state } from './runtime'
import Pagination from '../../../components/articles/Pagination'
import { ProfileNftCollection } from '../../../components/profile/ProfileNftCollection'
import '../../../components/profile/public-profile.css'
import { ProfilePaginationFixture } from './ProfilePaginationFixture'

// The profile's NFT collections. The article NFT section has its own fixture
// (e2e/fixtures/nft-v2).
function Fixture() {
  if (state === 'profile') {
    return (
      <main className="profile-page min-h-screen">
        <div className="profile-folio">
          <button
            onClick={() => document.documentElement.classList.toggle('dark')}
          >
            Toggle theme
          </button>
          <section aria-label="Articles">
            <div className="profile-pagination">
              <Pagination currentPage={1} totalPages={8} basePath="/writer" />
            </div>
          </section>
          <div className="profile-nfts">
            <ProfileNftCollection
              id="owned-nfts"
              title="Owned NFTs"
              description="Articles in this collection."
              total={72}
              displayedCount={9}
              page={1}
              pageSize={9}
              totalPages={8}
              getPageHref={(page) => `/writer?tab=nfts&nftOwnedPage=${page}`}
              isPaginating={false}
            >
              <p>Collection items</p>
            </ProfileNftCollection>
          </div>
        </div>
      </main>
    )
  }
  return <ProfilePaginationFixture />
}
createRoot(document.getElementById('root')!).render(<Fixture />)
