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
import { GuideWalletSettingsLink } from '@/components/guide/GuideWalletSettingsLink'
import { ActionableNotice } from '@/components/ui/ActionableNotice'
import { GuideSurface } from '@/components/layout/GuideSurface'
import { TESTNET_PRACTICE_NOTE } from '@/lib/copy/network-status'
import {
  WALLET_GUIDE_HEADING,
  WALLET_GUIDE_SUBHEAD,
} from '@/lib/copy/landing-sections'
import { WRITER_FEE_PHRASE } from '@/lib/copy/launch-guide'
import { cn } from '@/lib/utils'

const WALLET_GUIDE_TABS = [
  { value: 'what-is-wallet', label: 'What is a Wallet?' },
  { value: 'setup', label: 'Set Up Freighter' },
  { value: 'connect', label: 'Connect' },
  { value: 'first-tip', label: 'Your First Tip' },
] as const

function GuideTabIntro({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {children}
      </p>
    </div>
  )
}

export function WalletGuide() {
  return (
    <GuideSurface>
      <div className="text-center mb-10">
        <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-3">
          {WALLET_GUIDE_HEADING}
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto mb-3">
          {WALLET_GUIDE_SUBHEAD}
        </p>
        <ActionableNotice intent="informational" className="max-w-xl mx-auto">
          {TESTNET_PRACTICE_NOTE}
        </ActionableNotice>
      </div>

      <Tabs defaultValue="what-is-wallet" className="w-full">
        <div
          className="min-w-0 w-full overflow-hidden border-b border-border mb-8"
          aria-label="Wallet setup steps"
        >
          <TabsList className="h-auto w-full justify-start gap-4 sm:gap-8 rounded-none bg-transparent p-0">
            {WALLET_GUIDE_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={cn(
                  'shrink-0 rounded-none border-0 border-b-2 bg-transparent px-3 py-3 min-h-[44px] text-sm font-medium shadow-none whitespace-normal text-center leading-snug',
                  'text-muted-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none',
                  'data-[state=active]:border-brand-blue dark:data-[state=active]:border-primary',
                  'border-transparent hover:text-foreground hover:border-border'
                )}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="what-is-wallet">
          <GuideTabIntro title="No crypto experience? No problem.">
            Reading articles on Quilltip is completely free — no wallet needed.
            You only need a wallet if you want to <strong>tip writers</strong>{' '}
            for content you love.
          </GuideTabIntro>

          <WalletStepCard
            step={1}
            icon={Wallet}
            title="A wallet is like a digital account"
            description="Think of it as a simple app that holds your digital currency (XLM). It's similar to a payment app like Venmo or PayPal, but it runs on the Stellar blockchain — on testnet, tips settle in seconds with near-zero fees."
          />
          <WalletStepCard
            step={2}
            icon={Key}
            title="You control your wallet"
            description="Unlike traditional banks, your wallet is fully yours. Nobody — not even Quilltip — can access your testnet funds without your permission. When you tip a writer, you approve each transaction yourself."
          />
          <WalletStepCard
            step={3}
            icon={Coins}
            title="XLM is the currency"
            description="Stellar Lumens (XLM) is the currency used on Quilltip. Tips start at just $0.01 (about 0.026 XLM). On testnet, you get free XLM to practice with — no real money needed."
            isLast
          />
        </TabsContent>

        <TabsContent value="setup">
          <GuideTabIntro title="Freighter is the easiest Stellar wallet">
            It&apos;s a free browser extension that takes about 2 minutes to set
            up. Works with Chrome, Firefox, and Brave.
          </GuideTabIntro>

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
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
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
              className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground text-sm rounded-lg border border-border hover:bg-muted/80 transition-colors"
            >
              Stellar Friendbot (Testnet Faucet)
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </WalletStepCard>
        </TabsContent>

        <TabsContent value="connect">
          <GuideTabIntro title="Connect your wallet to Quilltip">
            Once Freighter is installed, connecting takes one click. Try it
            right here!
          </GuideTabIntro>

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
            <GuideWalletSettingsLink />
          </WalletStepCard>
        </TabsContent>

        <TabsContent value="first-tip">
          <GuideTabIntro title="Tipping on Quilltip is simple">
            You can tip an entire article or a specific highlight with testnet
            XLM. {WRITER_FEE_PHRASE} — typically within seconds on testnet.
          </GuideTabIntro>

          <WalletStepCard
            step={1}
            icon={BookOpen}
            title="Browse and read articles"
            description="Head to the Articles page to discover content. Reading is always free — no wallet or account required."
          >
            <Link
              href="/articles"
              className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground text-sm rounded-lg border border-border hover:bg-muted/80 transition-colors"
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
    </GuideSurface>
  )
}
