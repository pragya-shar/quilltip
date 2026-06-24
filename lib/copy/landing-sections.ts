import { LANDING_VALUE_SUBHEAD } from '@/lib/copy/landing-hero'
import { WRITER_FEE_PHRASE } from '@/lib/copy/launch-guide'

export const FEATURES_SECTION_BADGE = 'Live on Stellar Testnet'

export const FEATURES_SECTION_SUBHEAD = LANDING_VALUE_SUBHEAD

export const HOW_IT_WORKS_HEADING = 'How tipping works'

export const HOW_IT_WORKS_SUBHEAD = LANDING_VALUE_SUBHEAD

export interface HowItWorksStepCopy {
  title: string
  description: string
  detail: string
}

export const HOW_IT_WORKS_STEPS: HowItWorksStepCopy[] = [
  {
    title: 'Browse',
    description: 'Discover articles from writers across the platform',
    detail:
      'All articles are free to read. Explore by topic, trending, or latest. No paywalls, ever.',
  },
  {
    title: 'Tip',
    description: 'Connect a wallet and tip the passages that move you',
    detail:
      'Install Freighter, fund with free testnet XLM, and send tips that settle in about 3 seconds.',
  },
  {
    title: 'Publish & earn',
    description: 'Write, publish, and earn tips from readers',
    detail:
      'Use the rich editor to publish your work. Tips go directly to your wallet with near-zero fees.',
  },
]

export const TRUST_SECTION_HEADING = 'Trust and permanence'

export const TRUST_SECTION_SUBHEAD =
  'How Quilltip protects writers and readers.'

export const TRUST_BULLETS = [
  'Tips move wallet-to-wallet on Stellar through audited Soroban contracts',
  'Wallet apps like Freighter sign transactions locally on your device',
  `${WRITER_FEE_PHRASE} — fees enforced on-chain`,
  'Published articles are stored on Arweave for long-term availability',
] as const

export const TRUST_SECURITY_HEADING = 'Security and transparency'

export const TRUST_SECURITY_INTRO =
  'Quilltip never holds your funds. You approve every transaction in your own wallet app before it is sent.'

export interface LandingFeatureCopy {
  title: string
  description: string
  href: string
}

export const LANDING_FEATURE_COPY: LandingFeatureCopy[] = [
  {
    title: 'Interactive Reading',
    description: 'Highlight passages and tip the words that move you.',
    href: '/articles',
  },
  {
    title: 'Fast tips',
    description: 'Tips settle in about 3 seconds with near-zero fees.',
    href: '#how-it-works',
  },
  {
    title: 'Rich Editor',
    description: 'Code blocks, media embeds, and full markdown support.',
    href: '/register',
  },
  {
    title: '100% Ownership',
    description: 'Your content, your rules. No platform lock-in.',
    href: '#security',
  },
]

export interface FaqCopy {
  question: string
  answer: string
}

export const LANDING_FAQS: FaqCopy[] = [
  {
    question: 'Do I need cryptocurrency to read articles?',
    answer:
      'No. Reading is completely free — no wallet, no account, no crypto needed. You only need a wallet if you want to tip writers. Our Wallet Guide walks you through setup in a few minutes.',
  },
  {
    question: 'How does the tipping mechanism work?',
    answer:
      'Readers connect a Stellar wallet, browse articles, and click Tip to send funds directly to the writer. Transactions complete in a few seconds through Soroban smart contracts. Writers receive funds in their wallet with no withdrawal delay.',
  },
  {
    question:
      'Is Quilltip live on mainnet or testnet? When can I use it with real money?',
    answer:
      "We're live on testnet for now and working towards our mainnet launch soon. You can test all features with free testnet XLM — no real money needed.",
  },
  {
    question: 'What does it cost to use Quilltip as a writer or reader?',
    answer:
      'Reading articles: completely free, no wallet needed. Tipping writers: pay only the Stellar network fee (less than $0.01) plus your chosen tip amount. Publishing articles: free, no hosting fees or subscriptions.',
  },
]

export const NAV_RESOURCES_FEATURED_DESCRIPTION =
  'Set up your wallet and learn how tipping works.'

export const NAV_WALLET_GUIDE_DESCRIPTION = 'Set up your Stellar wallet'

export const WALLET_GUIDE_HEADING = 'Getting Started with Quilltip'

export const WALLET_GUIDE_SUBHEAD =
  'Everything you need to know to start reading, highlighting, and tipping writers — even if you have never used crypto before.'

export const SITE_META_DESCRIPTION =
  'Read for free, tip what moves you, and publish to earn on Quilltip.'
