import { createRoot } from 'react-dom/client'
import { WalletActivationProvider } from '../../../components/providers/WalletActivationContext'
import { WalletProvider } from '../../../components/providers/WalletProvider'
import { ArticleReaderSupport } from '../../../components/articles/ArticleReaderSupport'
import { HighlightTipButton } from '../../../components/highlights/HighlightTipButton'
import { HighlightTipGate } from '../../../components/highlights/HighlightTipGate'
import '../../../components/articles/reader.css'
import type { Id } from '../../../types/convex'
import { ARTICLES, seedBasket, seedReload } from './runtime'

// A stored tip or basket from an earlier visit, before anything mounts.
seedReload()
seedBasket()

const query = new URLSearchParams(location.search)
const PASSAGE =
  query.get('data') === 'worst'
    ? 'https://example.org/archive/2026/11/notes-toward-a-unified-theory-of-marginalia-readers-writers-and-the-strange-economics-of-paying-for-a-single-sentence?ref=quilltip&utm_source=reader'
    : 'The quick brown fox jumps over the lazy dog'
if (query.get('dir') === 'rtl') document.documentElement.dir = 'rtl'
const BODY = `Opening line. ${PASSAGE}. Closing line.`
const START = BODY.indexOf(PASSAGE)

function Fixture() {
  const article = ARTICLES.main
  return (
    <main
      className="reader-layout"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '32px 16px 120px',
        overflowWrap: 'anywhere',
      }}
    >
      <h1 className="reader-title">{article.title}</h1>
      <p className="reader-subtitle">By {article.author} · Stellar testnet</p>
      <p>{BODY}</p>
      <section aria-label="Passage" className="tip-fixture-passage">
        <blockquote>{PASSAGE}</blockquote>
        <HighlightTipGate articleId={article.id as Id<'articles'>}>
          <HighlightTipButton
            articleId={article.id as Id<'articles'>}
            articleSlug={article.slug}
            authorName={article.author}
            highlightText={PASSAGE}
            startOffset={START}
            endOffset={START + PASSAGE.length}
          />
        </HighlightTipGate>
      </section>
      <ArticleReaderSupport
        articleTitle={article.title}
        articleId={article.id as Id<'articles'>}
        articleSlug={article.slug}
        authorName={article.author}
      />
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
