'use client'

import { useState } from 'react'
import { InstallWalletDialog } from './InstallWalletDialog'
import './wallet-help.css'

export function WalletSetupHelp({
  receiving = false,
  initiallyOpen = false,
}: {
  receiving?: boolean
  initiallyOpen?: boolean
}) {
  const [installOpen, setInstallOpen] = useState(false)
  return (
    <div className="wallet-setup-help">
      <details open={initiallyOpen || undefined}>
        <summary>
          {receiving ? 'Help with your receiving wallet' : 'Wallet setup help'}
        </summary>
        <div className="wallet-help-content">
          <p>
            Reading is free. A wallet is only needed to send or receive tips.
          </p>
          <ol>
            <li>
              <button
                type="button"
                className="wallet-help-link"
                onClick={() => setInstallOpen(true)}
              >
                Choose a Stellar wallet
              </button>{' '}
              and follow its setup steps. Keep your recovery phrase somewhere
              safe. Never share it; QuillTip will never ask for it.
            </li>
            <li>
              In your wallet’s network settings, select <strong>Testnet</strong>
              . QuillTip uses free test XLM with no monetary value. No purchase
              is needed.
            </li>
            <li>
              In Freighter, use the testnet funding prompt, or open{' '}
              <a
                href="https://lab.stellar.org/account/fund"
                target="_blank"
                rel="noopener noreferrer"
              >
                Stellar Lab’s Friendbot funding tool ↗
              </a>
              , select Testnet, and paste your wallet’s public address. Wallet
              practice also offers free test funds after connecting.
            </li>
            <li>
              Return here and connect your wallet. Connecting shares your public
              address; sending a tip requires a separate approval.
            </li>
          </ol>
          {receiving && (
            <p>
              To receive tips, copy your Stellar public address (starting with
              G) from your wallet and save it as your receiving address. In the
              writing desk, connecting here also saves it. In Wallet, connecting
              and saving are separate; disconnecting keeps your saved address.
              Never enter a secret key.
            </p>
          )}
          <p>
            Before approving a tip, check the recipient, amount, network, and
            fee in your wallet.
          </p>
        </div>
      </details>
      <InstallWalletDialog open={installOpen} onOpenChange={setInstallOpen} />
    </div>
  )
}
