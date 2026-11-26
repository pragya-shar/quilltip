import { createRoot } from 'react-dom/client'
import { WalletActivationProvider } from '../../../components/providers/WalletActivationContext'
import { WalletProvider } from '../../../components/providers/WalletProvider'
import { ArticleTipsPanel } from '../../../components/editor/ArticleTipsPanel'
import {
  TipsUnavailableNote,
  type TipsUnavailableReason,
} from '../../../components/tipping/TipsUnavailableNote'
import '../../../components/editor/writing-workspace.css'
import '../../../components/articles/reader.css'
import type { Id } from '../../../types/convex'
import { ARTICLE_ID } from './runtime'

const params = new URLSearchParams(location.search)
const variant = params.get('variant') === 'dialog' ? 'dialog' : 'page'
const reader = params.get('reader') as TipsUnavailableReason | null

function Fixture() {
  if (reader) {
    return (
      <main style={{ maxWidth: 720, margin: 'auto', padding: '24px 16px' }}>
        <div className="reader-support">
          <TipsUnavailableNote reason={reader} />
        </div>
      </main>
    )
  }
  return (
    <div className="writing-workspace">
      <main className="locked-main">
        {variant === 'dialog' ? (
          <div
            className="writer-dialog small-dialog"
            style={{ position: 'static', margin: 'auto', transform: 'none' }}
          >
            <p>Your article is published and ready for readers.</p>
            <ArticleTipsPanel
              articleId={ARTICLE_ID as Id<'articles'>}
              variant="dialog"
            />
          </div>
        ) : (
          <ArticleTipsPanel articleId={ARTICLE_ID as Id<'articles'>} />
        )}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <WalletActivationProvider>
    <WalletProvider>
      <Fixture />
    </WalletProvider>
  </WalletActivationProvider>
)
