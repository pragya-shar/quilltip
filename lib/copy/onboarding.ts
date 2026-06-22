import { WALLET_SETUP_ACTION_LABEL } from '@/lib/copy/launch-guide'

export type OnboardingIntentId = 'read' | 'write' | 'wallet'

export interface OnboardingIntentCopy {
  id: OnboardingIntentId
  title: string
  description: string
  href: string
}

export const ONBOARDING_INTENTS: OnboardingIntentCopy[] = [
  {
    id: 'read',
    title: 'Read first',
    description: 'Discover stories and tip the passages that move you.',
    href: '/articles',
  },
  {
    id: 'write',
    title: 'Write first',
    description: 'Publish on Arweave and earn tips from readers.',
    href: '/write',
  },
  {
    id: 'wallet',
    title: WALLET_SETUP_ACTION_LABEL,
    description: 'Connect a Stellar wallet to send and receive tips.',
    href: '/dashboard/wallet',
  },
]
