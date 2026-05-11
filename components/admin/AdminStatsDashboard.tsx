'use client'

import type { ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Link as LinkIcon,
  Users,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export type AdminStatsSnapshot = {
  generatedAt: number
  users: {
    total: number
    withStellarAddress: number
    onboardingCompleted: number
  }
  articles: {
    total: number
    published: number
    drafts: number
    publishedWriters: number
  }
  articleTips: TipBucket
  highlightTips: TipBucket
  transactions: {
    totalCount: number
    confirmedCount: number
    failedCount: number
    suspiciousCount: number
    fraudulentCount: number
    totalConfirmedVolumeCents: number
    uniqueConfirmedTippers: number
    uniqueConfirmedWriters: number
  }
  recentTransactions: RecentTransaction[]
}

type TipBucket = {
  total: number
  byStatus: Record<string, number>
  confirmedCount: number
  totalConfirmedVolumeCents: number
}

type RecentTransaction = {
  id: string
  type: 'article' | 'highlight'
  status: string
  amountCents: number
  amountUsd: number
  articleTitle: string
  articleSlug: string
  highlightText?: string
  tipperName?: string
  authorName?: string
  stellarTxId?: string
  stellarNetwork?: string
  stellarExplorerUrl?: string
  createdAt: number
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function labelStatus(status: string) {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function statusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'CONFIRMED') return 'default'
  if (status === 'FAILED' || status === 'FRAUDULENT') return 'destructive'
  if (status === 'PENDING' || status === 'CONFIRMING') return 'secondary'
  return 'outline'
}

function StatCard({
  title,
  value,
  detail,
  icon: Icon,
  accent = 'text-primary',
}: {
  title: string
  value: string | number
  detail: ReactNode
  icon: typeof Users
  accent?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <div className="space-y-1">
          <CardDescription>{title}</CardDescription>
          <CardTitle className="text-3xl">{value}</CardTitle>
        </div>
        <Icon className={cn('mt-1 h-5 w-5', accent)} aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function StatusBreakdown({
  title,
  bucket,
}: {
  title: string
  bucket: TipBucket
}) {
  const entries = Object.entries(bucket.byStatus).sort(([a], [b]) =>
    a.localeCompare(b)
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {bucket.total} total · {bucket.confirmedCount} confirmed ·{' '}
          {formatMoney(bucket.totalConfirmedVolumeCents)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {entries.length === 0 ? (
          <span className="text-sm text-muted-foreground">No rows yet</span>
        ) : (
          entries.map(([status, count]) => (
            <Badge key={status} variant={statusBadgeVariant(status)}>
              {labelStatus(status)} · {count}
            </Badge>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function AdminStatsDashboard({ stats }: { stats: AdminStatsSnapshot }) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-normal text-muted-foreground">
          Internal Evidence
        </p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Beta Evidence Dashboard
            </h1>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              Live counters for the SCF beta goals: users, test transactions,
              confirmed volume, writer participation, and transaction health.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Generated {formatDate(stats.generatedAt)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Registered Users"
          value={stats.users.total}
          detail={`${stats.users.withStellarAddress} wallet-linked · ${stats.users.onboardingCompleted} onboarded`}
          icon={Users}
        />
        <StatCard
          title="Published Articles"
          value={stats.articles.published}
          detail={`${stats.articles.publishedWriters} writers · ${stats.articles.drafts} drafts`}
          icon={FileText}
          accent="text-blue-600"
        />
        <StatCard
          title="Total Transactions"
          value={stats.transactions.totalCount}
          detail={`${stats.transactions.confirmedCount} confirmed · ${stats.transactions.failedCount} failed`}
          icon={CheckCircle2}
          accent="text-emerald-600"
        />
        <StatCard
          title="Confirmed Volume"
          value={formatMoney(stats.transactions.totalConfirmedVolumeCents)}
          detail={
            <>
              <span>{stats.transactions.uniqueConfirmedTippers}</span> tippers ·{' '}
              {stats.transactions.uniqueConfirmedWriters} writers
            </>
          }
          icon={CircleDollarSign}
          accent="text-amber-600"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatusBreakdown title="Article Tips" bucket={stats.articleTips} />
        <StatusBreakdown title="Highlight Tips" bucket={stats.highlightTips} />
      </div>

      {(stats.transactions.suspiciousCount > 0 ||
        stats.transactions.fraudulentCount > 0) && (
        <Card className="border-amber-300 bg-amber-50 text-amber-950">
          <CardHeader className="flex flex-row items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5" aria-hidden="true" />
            <div>
              <CardTitle>Audit Attention</CardTitle>
              <CardDescription className="text-amber-900">
                {stats.transactions.suspiciousCount} suspicious amount checks ·{' '}
                {stats.transactions.fraudulentCount} fraudulent article tips
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
          <CardDescription>
            Latest article and highlight tip rows, linked to Stellar Explorer
            when a transaction hash exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Article</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.recentTransactions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No transactions yet.
                  </TableCell>
                </TableRow>
              ) : (
                stats.recentTransactions.map((tx) => (
                  <TableRow key={`${tx.type}-${tx.id}`}>
                    <TableCell className="capitalize">{tx.type}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(tx.status)}>
                        {tx.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{tx.articleTitle}</div>
                      {tx.highlightText && (
                        <div className="max-w-[28rem] truncate text-xs text-muted-foreground">
                          {tx.highlightText}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{formatMoney(tx.amountCents)}</TableCell>
                    <TableCell>
                      {tx.stellarTxId && tx.stellarExplorerUrl ? (
                        <a
                          href={tx.stellarExplorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-ring inline-flex items-center gap-1 rounded text-primary hover:underline"
                        >
                          <LinkIcon className="h-3.5 w-3.5" />
                          {tx.stellarTxId}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Missing</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDate(tx.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
