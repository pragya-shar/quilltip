import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { WalletActivationProvider } from '../../../components/providers/WalletActivationContext'
import { WalletProvider } from '../../../components/providers/WalletProvider'
import { WalletConnectButton } from '../../../components/stellar/WalletConnectButton'
import { TipButton } from '../../../components/tipping/TipButton'
import type { Id } from '../../../types/convex'
import { AUTHOR } from './runtime'

function Fixture() {
  return (
    <main
      className="reader-surface"
      style={{ maxWidth: 720, margin: 'auto', padding: '24px 16px' }}
    >
      <h1 className="text-xl mb-4">Wallet fixtures</h1>
      <section aria-label="Wallet" className="mb-8">
        <WalletConnectButton />
      </section>
      <section aria-label="Tip">
        <TipButton
          articleTitle="The words we keep"
          articleId={'qa-article' as Id<'articles'>}
          authorName="Writer"
          authorStellarAddress={AUTHOR}
        />
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <WalletActivationProvider>
    <WalletProvider>
      <Fixture />
      <Toaster />
    </WalletProvider>
  </WalletActivationProvider>
)
