import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { NFTIntegration } from '../../../components/nft/NFTIntegration'
import { MintButton } from '../../../components/nft/MintButton'
import { articleTitle, state } from './runtime'
import type { Id } from '../../../types/convex'
import Pagination from '../../../components/articles/Pagination'
import { ProfileNftCollection } from '../../../components/profile/ProfileNftCollection'
import '../../../components/profile/public-profile.css'

const articleId = 'qa-article' as Id<'articles'>
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
  return (
    <main
      className="reader-surface"
      style={{ maxWidth: 720, margin: 'auto', padding: '24px 20px' }}
    >
      <h1 className="text-xl mb-4">NFT presentation fixtures</h1>
      <nav className="flex flex-wrap gap-3 mb-6" aria-label="Fixture states">
        {[
          'owner',
          'visitor',
          'unminted-visitor',
          'eligible',
          'ineligible',
          'loading',
        ].map((value) => (
          <a className="underline" key={value} href={`?state=${value}`}>
            {value}
          </a>
        ))}
        <button
          className="underline"
          onClick={() => document.documentElement.classList.toggle('dark')}
        >
          Toggle theme
        </button>
      </nav>
      <h2 className="reader-section-title">NFT Collection</h2>
      <NFTIntegration
        articleId={articleId}
        articleTitle={articleTitle}
        articleSlug="qa-article"
        authorId={'qa-author' as Id<'users'>}
        currentUserId={
          (state.includes('visitor')
            ? 'qa-visitor'
            : 'qa-author') as Id<'users'>
        }
        embedded
      />
      {state === 'ineligible' && (
        <div className="mt-6">
          <MintButton
            articleId={articleId}
            articleTitle={articleTitle}
            articleSlug="qa-article"
            totalTips={2.5}
            threshold={10}
            isAuthor
          />
        </div>
      )}
      <Toaster />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
