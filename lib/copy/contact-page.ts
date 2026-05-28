import { LEGAL_CONTACT_EMAIL } from '@/lib/copy/legal-shared'
import {
  MAINNET_COMING_NOTE,
  TESTNET_PRACTICE_NOTE,
} from '@/lib/copy/network-status'

export const SECURITY_CONTACT_EMAIL = 'security@quilltip.me'

export type ContactChannel = {
  id: string
  title: string
  email: string
  description: string
}

export const contactIntro =
  'Reach the Quilltip team for legal, privacy, security, and general questions about the testnet product.'

export const contactChannels: ContactChannel[] = [
  {
    id: 'legal',
    title: 'Legal and privacy',
    email: LEGAL_CONTACT_EMAIL,
    description:
      'Questions about our Terms of Service, Privacy Policy, data requests, or account-related legal matters.',
  },
  {
    id: 'security',
    title: 'Security reports',
    email: SECURITY_CONTACT_EMAIL,
    description:
      'Report vulnerabilities privately. Do not open public GitHub issues for security concerns.',
  },
]

export const contactNotes = [
  TESTNET_PRACTICE_NOTE,
  MAINNET_COMING_NOTE,
  'Quilltip does not process real-money payments today. Billing, refund, or chargeback requests do not apply to testnet practice funds.',
  'We aim to respond to general inquiries within a few business days. Security reports receive acknowledgment within 48 hours per our security policy.',
]
