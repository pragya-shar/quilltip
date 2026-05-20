import {
  MAINNET_COMING_NOTE,
  TESTNET_PRACTICE_NOTE,
} from '@/lib/copy/network-status'

export const SUPPORT_GITHUB_URL =
  'https://github.com/pragya-shar/quilltip/issues'

export type InfoSection = {
  id: string
  title: string
  paragraphs: string[]
}

export const supportIntro =
  'Help for using Quilltip on Stellar testnet. Tips use free test XLM for practice—not real money.'

export const supportSections: InfoSection[] = [
  {
    id: 'scope',
    title: 'What we support today',
    paragraphs: [
      TESTNET_PRACTICE_NOTE,
      MAINNET_COMING_NOTE,
      'On testnet, writers keep 97.5% of each practice tip and Quilltip retains 2.5% to cover platform operations. Testnet balances have no real-world monetary value.',
    ],
  },
  {
    id: 'wallet',
    title: 'Wallet and tipping help',
    paragraphs: [
      'If you are new to Stellar wallets or testnet XLM, start with our step-by-step wallet guide. It covers connecting Freighter, xBull, Albedo, or hot wallet, funding with test XLM, and sending your first practice tip.',
    ],
  },
  {
    id: 'bugs',
    title: 'Bug reports and feature requests',
    paragraphs: [
      'For technical issues, broken flows, or product feedback, open a GitHub issue. Include what you tried, what you expected, and any error messages or transaction IDs if relevant.',
    ],
  },
  {
    id: 'other',
    title: 'Other questions',
    paragraphs: [
      'For legal, privacy, or account-related questions, use the contact page. Do not post security vulnerabilities in public issues—email security@quilltip.me instead.',
    ],
  },
]

export const supportResourceLinks = [
  { label: 'Wallet Guide', href: '/guide' },
  { label: 'FAQ on homepage', href: '/#faq' },
  { label: 'GitHub Issues', href: SUPPORT_GITHUB_URL },
  { label: 'Contact', href: '/contact' },
]
