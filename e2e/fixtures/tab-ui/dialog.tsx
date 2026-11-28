/**
 * Tip dialog fixture page (issue #546): `/dialog?state=<id>[&article=shared]
 * [&data=worst]`. It renders the real article and passage tip buttons and
 * dialogs. The wallet tip runs against the v2 tip fixture's stand-ins
 * (e2e/fixtures/tips-v2/runtime.ts); the dialog's "from your tab" section
 * runs against this fixture's tab backend for the scenario `state`, with
 * this browser's key store seeded first (session.ts).
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { WalletActivationProvider } from '../../../components/providers/WalletActivationContext'
import { WalletProvider } from '../../../components/providers/WalletProvider'
import { ArticleTipV2 } from '../../../components/tipping/v2/ArticleTipV2'
import { HighlightTipV2 } from '../../../components/tipping/v2/HighlightTipV2'
import type { Id } from '../../../types/convex'
import { ARTICLES } from '../tips-v2/runtime'
import { noteBoot, scenario, seedDevice, stateId } from './session'

const params = new URLSearchParams(location.search)
const article =
  scenario?.splits || params.get('article') === 'shared'
    ? ARTICLES.shared
    : ARTICLES.main
const PASSAGE =
  params.get('data') === 'worst'
    ? 'https://example.org/archive/2026/11/notes-toward-a-unified-theory-of-marginalia-readers-writers-and-the-strange-economics-of-paying-for-a-single-sentence?ref=quilltip'
    : 'The quick brown fox jumps over the lazy dog'

function Fixture() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '32px 16px 120px',
        overflowWrap: 'anywhere',
      }}
    >
      <h1>{article.title}</h1>
      <p data-testid="fixture-state">
        Fixture: {scenario?.title ?? stateId} · By {article.author} · Stellar
        testnet
      </p>
      <ArticleTipV2
        articleId={article.id as Id<'articles'>}
        articleTitle={article.title}
        articleSlug={article.slug}
        authorName={article.author}
      />
      <blockquote>{PASSAGE}</blockquote>
      <HighlightTipV2
        articleId={article.id as Id<'articles'>}
        articleSlug={article.slug}
        authorName={article.author}
        highlightText={PASSAGE}
        startOffset={14}
        endOffset={14 + PASSAGE.length}
      />
    </main>
  )
}

void seedDevice(scenario?.device ?? 'none').then(() => {
  noteBoot('render')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <WalletActivationProvider>
        <WalletProvider>
          <Fixture />
        </WalletProvider>
      </WalletActivationProvider>
    </StrictMode>
  )
})
