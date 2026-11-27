import { createRoot } from 'react-dom/client'
import { Trophy } from 'lucide-react'
import { WalletActivationProvider } from '../../../components/providers/WalletActivationContext'
import { WalletProvider } from '../../../components/providers/WalletProvider'
import { NFTIntegration } from '../../../components/nft/NFTIntegration'
import ArticleNftV2 from '../../../components/nft/v2/ArticleNftV2'
import '../../../components/articles/reader.css'
import type { Id } from '../../../types/convex'
import { ARTICLE_ID, AUTHOR_ID, viewerOf } from './runtime'

// The article details panel around the NFT section, as the article page
// renders it (components/articles/ArticleDetailsPanel.tsx).
const viewer = viewerOf()
// `bare=1`: the v2 section with no v1 panel to fall back to, as it renders
// once the v1 code is removed (docs/operations/payments-v2-cutover.md, 8).
const bare = new URLSearchParams(location.search).get('bare') === '1'
const currentUserId =
  viewer === 'signed-out'
    ? undefined
    : viewer === 'author' || viewer === 'owner'
      ? AUTHOR_ID
      : 'u-reader'

function Fixture() {
  return (
    <main style={{ maxWidth: 720, margin: 'auto', padding: '24px 16px' }}>
      <div className="reader-details">
        <div className="reader-details-content">
          <div className="reader-details-sections">
            <section className="reader-details-section">
              <h4 className="reader-section-title">
                <Trophy className="w-4 h-4 text-muted-foreground" />
                NFT Collection
              </h4>
              {bare ? (
                <ArticleNftV2
                  articleId={ARTICLE_ID as Id<'articles'>}
                  authorId={AUTHOR_ID as Id<'users'>}
                  currentUserId={currentUserId as Id<'users'> | undefined}
                  embedded
                />
              ) : (
                <NFTIntegration
                  articleId={ARTICLE_ID as Id<'articles'>}
                  articleTitle="The words we keep"
                  articleSlug="the-words-we-keep"
                  authorId={AUTHOR_ID as Id<'users'>}
                  currentUserId={currentUserId as Id<'users'> | undefined}
                  embedded
                />
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <WalletActivationProvider>
    <WalletProvider>
      <Fixture />
    </WalletProvider>
  </WalletActivationProvider>
)
