'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WalletStepCard } from './WalletStepCard'
import { WalletConnectButton } from '@/components/stellar/WalletConnectButton'
import {
  Wallet,
  Download,
  Key,
  Droplets,
  PlugZap,
  BookOpen,
  Highlighter,
  Coins,
  ExternalLink,
} from 'lucide-react'
import Link from 'next/link'

export function WalletGuide() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <h1 className="text-3xl lg:text-4xl font-bold text-neutral-900 mb-3">
          Getting Started with Quilltip
        </h1>
        <p className="text-neutral-600 max-w-xl mx-auto">
          Everything you need to know to start reading, highlighting, and
          tipping writers — even if you&apos;ve never used crypto before.
        </p>
      </div>

      <Tabs defaultValue="what-is-wallet" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-8">
          <TabsTrigger value="what-is-wallet" className="text-xs sm:text-sm">
            What is a Wallet?
          </TabsTrigger>
          <TabsTrigger value="setup" className="text-xs sm:text-sm">
            Set Up Freighter
          </TabsTrigger>
          <TabsTrigger value="connect" className="text-xs sm:text-sm">
            Connect
          </TabsTrigger>
          <TabsTrigger value="first-tip" className="text-xs sm:text-sm">
            Your First Tip
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: What is a Wallet? */}
        <TabsContent value="what-is-wallet">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">
              No crypto experience? No problem.
            </h2>
            <p className="text-sm text-blue-800 leading-relaxed">
              Reading articles on Quilltip is completely free — no wallet
              needed. You only need a wallet if you want to{' '}
              <strong>tip writers</strong> for content you love.
            </p>
          </div>

          <WalletStepCard
            step={1}
            icon={Wallet}
            title="A wallet is like a digital account"
            description="Think of it as a simple app that holds your digital currency (XLM). It's similar to a payment app like Venmo or PayPal, but it runs on the Stellar blockchain — meaning payments are instant and fees are nearly zero."
          />
          <WalletStepCard
            step={2}
            icon={Key}
            title="You control your money"
            description="Unlike traditional banks, your wallet is fully yours. Nobody — not even Quilltip — can access your funds without your permission. When you tip a writer, you approve each transaction yourself."
          />
          <WalletStepCard
            step={3}
            icon={Coins}
            title="XLM is the currency"
            description="Stellar Lumens (XLM) is the currency used on Quilltip. Tips start at just $0.01 (about 0.026 XLM). On testnet, you get free XLM to practice with — no real money needed."
            isLast
          />
        </TabsContent>

        {/* Tab 2: Set Up Freighter */}
        <TabsContent value="setup">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-amber-900 mb-2">
              Freighter is the easiest Stellar wallet
            </h2>
            <p className="text-sm text-amber-800 leading-relaxed">
              It&apos;s a free browser extension that takes about 2 minutes to
              set up. Works with Chrome, Firefox, and Brave.
            </p>
          </div>

          <WalletStepCard
            step={1}
            icon={Download}
            title="Install the Freighter extension"
            description="Visit the Freighter website and click 'Add to Chrome' (or your browser). It installs like any other browser extension."
          >
            <a
              href="https://www.freighter.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-sm rounded-lg hover:bg-neutral-800 transition-colors"
            >
              Get Freighter
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </WalletStepCard>

          <WalletStepCard
            step={2}
            icon={Key}
            title="Create your wallet"
            description="Open Freighter from your browser toolbar, set a password, and it will generate your wallet. Important: Write down your recovery phrase and store it somewhere safe — this is the only way to recover your wallet if you lose access."
          />

          <WalletStepCard
            step={3}
            icon={Droplets}
            title="Get free testnet XLM"
            description="Switch Freighter to 'Testnet' in its settings, then use the Stellar friendbot to get free test XLM. This lets you practice tipping without spending real money."
            isLast
          >
            <a
              href="https://laboratory.stellar.org/#account-creator?network=test"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-100 text-neutral-700 text-sm rounded-lg hover:bg-neutral-200 transition-colors"
            >
              Stellar Friendbot (Testnet Faucet)
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </WalletStepCard>
        </TabsContent>

        {/* Tab 3: Connect to Quilltip */}
        <TabsContent value="connect">
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-green-900 mb-2">
              Connect your wallet to Quilltip
            </h2>
            <p className="text-sm text-green-800 leading-relaxed">
              Once Freighter is installed, connecting takes one click. Try it
              right here!
            </p>
          </div>

          <WalletStepCard
            step={1}
            icon={PlugZap}
            title="Click the button below to connect"
            description="This will open your Freighter extension and ask for permission to share your public address with Quilltip. No funds are transferred — it's just connecting."
          >
            <div className="mt-2">
              <WalletConnectButton />
            </div>
          </WalletStepCard>

          <WalletStepCard
            step={2}
            icon={Wallet}
            title="Save your wallet on your profile"
            description="After connecting, visit your profile to save your wallet address for receiving tips. This is your 'receiving wallet' — when readers tip your articles, payments arrive here."
            isLast
          >
            <Link
              href="/profile"
              className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-100 text-neutral-700 text-sm rounded-lg hover:bg-neutral-200 transition-colors"
            >
              Go to Profile Settings
            </Link>
          </WalletStepCard>
        </TabsContent>

        {/* Tab 4: Your First Tip */}
        <TabsContent value="first-tip">
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-purple-900 mb-2">
              Tipping on Quilltip is simple
            </h2>
            <p className="text-sm text-purple-800 leading-relaxed">
              You can tip an entire article or a specific highlight. 97.5% goes
              directly to the writer — instantly.
            </p>
          </div>

          <WalletStepCard
            step={1}
            icon={BookOpen}
            title="Browse and read articles"
            description="Head to the Articles page to discover content. Reading is always free — no wallet or account required."
          >
            <Link
              href="/articles"
              className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-100 text-neutral-700 text-sm rounded-lg hover:bg-neutral-200 transition-colors"
            >
              Browse Articles
            </Link>
          </WalletStepCard>

          <WalletStepCard
            step={2}
            icon={Highlighter}
            title="Highlight your favorite passages"
            description="Select any text in an article to highlight it. Choose a color, add a note, and save. Highlights are your way of marking what resonated with you."
          />

          <WalletStepCard
            step={3}
            icon={Coins}
            title="Send a tip"
            description='Click "Tip Author" on any article or "Tip Highlight" on a passage you loved. Pick an amount (starting at $0.01), confirm in your wallet, and the writer receives it in 3 seconds.'
            isLast
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
