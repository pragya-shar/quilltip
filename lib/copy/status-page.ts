import {
  MAINNET_COMING_NOTE,
  TESTNET_PRACTICE_NOTE,
} from '@/lib/copy/network-status'

export type StatusService = {
  id: string
  name: string
  status: string
  detail: string
}

export const statusIntro =
  'Current platform scope for Quilltip. This page describes our testnet launch status—not a live uptime dashboard for mainnet production payments.'

export const statusBanner = TESTNET_PRACTICE_NOTE

export const statusServices: StatusService[] = [
  {
    id: 'website',
    name: 'Quilltip website',
    status: 'Operational',
    detail:
      'Beta on Vercel. Reading, publishing, and account features are available.',
  },
  {
    id: 'backend',
    name: 'Convex backend',
    status: 'Operational',
    detail: 'Real-time articles, tips, and user data on Convex Cloud.',
  },
  {
    id: 'stellar',
    name: 'Stellar testnet tipping',
    status: 'Operational on testnet',
    detail:
      'Tips and withdrawals use test XLM only. Not connected to mainnet or real funds.',
  },
  {
    id: 'arweave',
    name: 'Arweave storage',
    status: 'Operational',
    detail: 'Published articles may be stored permanently on Arweave.',
  },
]

export const statusNotes = [
  MAINNET_COMING_NOTE,
  'Stage: Beta. Network: Stellar Testnet. Tips have no real-world monetary value.',
]
