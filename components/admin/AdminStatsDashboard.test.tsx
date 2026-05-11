/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  AdminStatsDashboard,
  type AdminStatsSnapshot,
} from '@/components/admin/AdminStatsDashboard'

const stats: AdminStatsSnapshot = {
  generatedAt: new Date('2026-05-11T12:00:00Z').getTime(),
  users: {
    total: 100,
    withStellarAddress: 64,
    onboardingCompleted: 41,
  },
  articles: {
    total: 52,
    published: 38,
    drafts: 14,
    publishedWriters: 12,
  },
  articleTips: {
    total: 300,
    byStatus: { CONFIRMED: 260, FAILED: 40 },
    confirmedCount: 260,
    totalConfirmedVolumeCents: 12_345,
  },
  highlightTips: {
    total: 220,
    byStatus: { CONFIRMED: 200, PENDING: 20 },
    confirmedCount: 200,
    totalConfirmedVolumeCents: 6_789,
  },
  transactions: {
    totalCount: 520,
    confirmedCount: 460,
    failedCount: 40,
    suspiciousCount: 2,
    fraudulentCount: 1,
    totalConfirmedVolumeCents: 19_134,
    uniqueConfirmedTippers: 75,
    uniqueConfirmedWriters: 12,
  },
  recentTransactions: [
    {
      id: 'tx1',
      type: 'highlight',
      status: 'CONFIRMED',
      amountCents: 50,
      amountUsd: 0.5,
      articleTitle: 'Evidence Article',
      articleSlug: 'evidence',
      highlightText: 'the tipped sentence',
      tipperName: 'Reader',
      authorName: 'Author',
      stellarTxId: 'abc123',
      stellarNetwork: 'TESTNET',
      stellarExplorerUrl: 'https://stellar.expert/explorer/testnet/tx/abc123',
      createdAt: new Date('2026-05-11T11:00:00Z').getTime(),
    },
  ],
}

describe('AdminStatsDashboard', () => {
  it('renders beta evidence totals and recent transaction links', () => {
    render(<AdminStatsDashboard stats={stats} />)

    expect(
      screen.getByRole('heading', { name: 'Beta Evidence Dashboard' })
    ).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('520')).toBeInTheDocument()
    expect(screen.getByText('$191.34')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
    expect(screen.getByText('Evidence Article')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'abc123' })).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/testnet/tx/abc123'
    )
  })
})
