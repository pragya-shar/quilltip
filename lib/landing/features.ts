import {
  Edit3,
  DollarSign,
  Shield,
  Zap,
  MessageSquare,
  TrendingUp,
  Globe,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { MIN_WITHDRAWAL_USD } from '@/lib/constants'

export interface LandingFeature {
  icon: LucideIcon
  title: string
  description: string
  href: string
}

export const LANDING_FEATURES: LandingFeature[] = [
  {
    icon: Edit3,
    title: 'Rich Editor',
    description: 'Code blocks, media embeds, and full markdown support.',
    href: '/register',
  },
  {
    icon: DollarSign,
    title: 'Fast Testnet Tips',
    description:
      'Tips settle in about 3 seconds on Stellar testnet with near-zero fees.',
    href: '#how-it-works',
  },
  {
    icon: MessageSquare,
    title: 'Interactive Reading',
    description: 'Highlight passages and tip the words that move you.',
    href: '/articles',
  },
  {
    icon: Shield,
    title: '100% Ownership',
    description: 'Your content, your rules. No platform lock-in.',
    href: '#security',
  },
  {
    icon: TrendingUp,
    title: 'Testnet Analytics',
    description:
      'Track testnet tip activity and audience growth as it happens.',
    href: '/register',
  },
  {
    icon: Zap,
    title: 'Withdraw Testnet Earnings',
    description: `Move testnet earnings to your wallet once your balance reaches $${MIN_WITHDRAWAL_USD.toFixed(0)}.`,
    href: '#how-it-works',
  },
  {
    icon: Globe,
    title: 'Permanent Storage',
    description: 'Articles stored forever on Arweave.',
    href: '#arweave-storage',
  },
  {
    icon: Sparkles,
    title: 'NFT Minting',
    description: 'Mint top articles as collectible NFTs.',
    href: '#features',
  },
]
