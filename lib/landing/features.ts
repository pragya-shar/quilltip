import {
  Edit3,
  DollarSign,
  Shield,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'

export interface LandingFeature {
  icon: LucideIcon
  title: string
  description: string
  href: string
}

export const LANDING_FEATURES: LandingFeature[] = [
  {
    icon: MessageSquare,
    title: 'Interactive Reading',
    description: 'Highlight passages and tip the words that move you.',
    href: '/articles',
  },
  {
    icon: DollarSign,
    title: 'Fast Testnet Tips',
    description:
      'Tips settle in about 3 seconds on Stellar testnet with near-zero fees.',
    href: '#how-it-works',
  },
  {
    icon: Edit3,
    title: 'Rich Editor',
    description: 'Code blocks, media embeds, and full markdown support.',
    href: '/register',
  },
  {
    icon: Shield,
    title: '100% Ownership',
    description: 'Your content, your rules. No platform lock-in.',
    href: '#security',
  },
]
