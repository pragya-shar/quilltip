import {
  MAINNET_COMING_NOTE,
  TESTNET_PRACTICE_NOTE,
} from '@/lib/copy/network-status'
import { SECURITY_CONTACT_EMAIL } from '@/lib/copy/contact-page'

export const SUPPORT_GITHUB_URL =
  'https://github.com/pragya-shar/quilltip/issues'

export type InfoSection = {
  id: string
  title: string
  paragraphs: string[]
  link?: { label: string; href: string }
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
      'If you are new to Stellar wallets or testnet XLM, start with our wallet setup help in wallet practice. It covers connecting Freighter, xBull, Albedo, or hot wallet, funding with test XLM, and sending your first practice tip.',
    ],
    link: {
      label: 'Wallet setup and practice',
      href: '/wallet/practice#wallet-help',
    },
  },
  {
    id: 'bugs',
    title: 'Bug reports and feature requests',
    paragraphs: [
      'For technical issues, broken flows, or product feedback, open a GitHub issue. Include what you tried, what you expected, and any error messages or transaction IDs if relevant.',
    ],
    link: { label: 'Open GitHub Issues', href: SUPPORT_GITHUB_URL },
  },
  {
    id: 'other',
    title: 'Other questions',
    paragraphs: [
      'For legal, privacy, or account-related questions, use the contact page.',
    ],
    link: { label: 'Contact the team', href: '/contact' },
  },
  {
    id: 'security',
    title: 'Report a security concern privately',
    paragraphs: [
      'Do not post security vulnerabilities in public GitHub issues. Email our security team privately with the details so we can investigate.',
    ],
    link: {
      label: SECURITY_CONTACT_EMAIL,
      href: `mailto:${SECURITY_CONTACT_EMAIL}`,
    },
  },
]

export const supportResourceLinks = [
  { label: 'Wallet setup and practice', href: '/wallet/practice#wallet-help' },
  { label: 'FAQ on homepage', href: '/#faq' },
  { label: 'GitHub Issues', href: SUPPORT_GITHUB_URL },
  { label: 'Contact', href: '/contact' },
]
