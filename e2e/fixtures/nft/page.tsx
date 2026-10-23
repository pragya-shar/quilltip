import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { NFTIntegration } from '../../../components/nft/NFTIntegration'
import { MintButton } from '../../../components/nft/MintButton'
import { articleTitle, state } from './runtime'
import type { Id } from '../../../types/convex'

const articleId = 'qa-article' as Id<'articles'>
function Fixture() {
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
