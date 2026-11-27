import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { WalletActivationProvider } from '../../../components/providers/WalletActivationContext'
import { WalletProvider } from '../../../components/providers/WalletProvider'
import { WalletConnectButton } from '../../../components/stellar/WalletConnectButton'
import { TipButton } from '../../../components/tipping/TipButton'
import type { Id } from '../../../types/convex'
import { ReceivingWalletVerification } from '../../../components/stellar/ReceivingWalletVerification'
import { InstallWalletDialog } from '../../../components/stellar/InstallWalletDialog'
import { WalletAccountContent } from '../../../components/dashboard/WalletAccountContent'
import type { CurrentUserDoc } from '../../../types/convex'
import '../../../components/account/account.css'
import { AUTHOR, fixtureUser } from './runtime'

const view = new URLSearchParams(location.search).get('view')

function Fixture() {
  return (
    <main
      className="reader-surface"
      style={{ maxWidth: 720, margin: 'auto', padding: '24px 16px' }}
    >
      <h1 className="text-xl mb-4">Wallet fixtures</h1>
      {view === 'verify' && (
        <section
          aria-label="Receiving wallet"
          className="account-surface mb-8"
          style={{ padding: 16 }}
        >
          <ReceivingWalletVerification />
        </section>
      )}
      {view === 'dashboard' && (
        <section aria-label="Dashboard wallet" className="account-surface mb-8">
          <WalletAccountContent user={fixtureUser() as CurrentUserDoc} />
        </section>
      )}
      {view === 'install' && (
        <InstallWalletDialog open onOpenChange={() => {}} />
      )}
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
