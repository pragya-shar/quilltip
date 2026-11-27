import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { WalletActivationProvider } from '../../../components/providers/WalletActivationContext'
import { WalletProvider } from '../../../components/providers/WalletProvider'
import { WalletConnectButton } from '../../../components/stellar/WalletConnectButton'
import { TipButtonV1 as TipButton } from '../../../components/tipping/TipButtonV1'
import type { Id } from '../../../types/convex'
import { ReceivingWalletVerification } from '../../../components/stellar/ReceivingWalletVerification'
import { InstallWalletDialog } from '../../../components/stellar/InstallWalletDialog'
import { WalletAccountContent } from '../../../components/dashboard/WalletAccountContent'
import type { CurrentUserDoc } from '../../../types/convex'
import '../../../components/account/account.css'
import { AUTHOR, fixtureUser } from './runtime'

const params = new URLSearchParams(location.search)
const view = params.get('view')
// `theme=dark` sets the site's dark appearance; the dashboard sections stay light.
if (params.get('theme') === 'dark')
  document.documentElement.classList.add('dark')

// The dashboard puts its content on the paper folio over the rose surface.
const FOLIO_FRAME = { minHeight: 'auto', padding: 8 }
const FOLIO = { minHeight: 'auto', margin: 0, padding: 16 }

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
          style={FOLIO_FRAME}
        >
          <div className="account-folio" style={FOLIO}>
            <ReceivingWalletVerification />
          </div>
        </section>
      )}
      {view === 'dashboard' && (
        <section
          aria-label="Dashboard wallet"
          className="account-surface mb-8"
          style={FOLIO_FRAME}
        >
          <div className="account-folio" style={FOLIO}>
            <WalletAccountContent user={fixtureUser() as CurrentUserDoc} />
          </div>
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
