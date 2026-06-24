'use client'

import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import type { Doc } from '@/types/convex'
import { Card, CardContent } from '@/components/ui/card'

export type ReceivedTipRow = Doc<'tips'> & {
  tipper: { name?: string; username?: string } | null
  articleTitle: string
}

type TipHistoryProps = {
  tips: ReceivedTipRow[] | undefined
}

type PageSize = 10 | 25 | 50 | 'all'
type SortKey = 'tipper' | 'articleTitle' | 'amountUsd' | 'createdAt'
type SortDir = 'asc' | 'desc'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'tipper', label: 'Tipper' },
  { value: 'articleTitle', label: 'Article' },
  { value: 'amountUsd', label: 'Amount' },
  { value: 'createdAt', label: 'Date' },
]

function getTipperName(tip: ReceivedTipRow) {
  return tip.tipper?.name || tip.tipper?.username || 'Anonymous'
}

function formatTipDate(createdAt: number) {
  const tipDate = new Date(createdAt)
  const relative = formatDistanceToNow(tipDate, { addSuffix: true })
  const absolute = tipDate.toLocaleDateString('en-US', { dateStyle: 'long' })
  const a11yLabel = `${relative}. ${absolute}.`
  return { tipDate, relative, absolute, a11yLabel }
}

function TipDateTime({ createdAt }: { createdAt: number }) {
  const { tipDate, relative, absolute, a11yLabel } = formatTipDate(createdAt)
  return (
    <time
      dateTime={tipDate.toISOString()}
      title={absolute}
      aria-label={a11yLabel}
      className="text-xs text-muted-foreground"
    >
      {relative}
    </time>
  )
}

function csvEscape(value: string) {
  const mustQuote = /[",\n\r]/.test(value)
  if (!mustQuote) return value
  return `"${value.replaceAll('"', '""')}"`
}

function downloadCsv(args: { filename: string; csv: string }) {
  const blob = new Blob([args.csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = args.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function TipHistory({ tips }: TipHistoryProps) {
  const list = tips?.length ? tips : null
  const [pageSize, setPageSize] = useState<PageSize>(10)
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sortedTips = useMemo(() => {
    if (!list) return null

    const dir = sortDir === 'asc' ? 1 : -1

    const compareStrings = (a: string, b: string) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' }) * dir
    const compareNumbers = (a: number, b: number) => (a - b) * dir

    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'tipper':
          return compareStrings(getTipperName(a), getTipperName(b))
        case 'articleTitle':
          return compareStrings(a.articleTitle, b.articleTitle)
        case 'amountUsd':
          return compareNumbers(a.amountUsd, b.amountUsd)
        case 'createdAt':
          return compareNumbers(a.createdAt, b.createdAt)
        default: {
          const _exhaustive: never = sortKey
          return _exhaustive
        }
      }
    })
  }, [list, sortDir, sortKey])

  const visibleTips = useMemo(() => {
    if (!sortedTips) return null
    if (pageSize === 'all') return sortedTips
    return sortedTips.slice(0, pageSize)
  }, [pageSize, sortedTips])

  const setSort = (nextKey: SortKey) => {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(nextKey)
    setSortDir(nextKey === 'createdAt' ? 'desc' : 'asc')
  }

  const ariaSort = (key: SortKey): 'none' | 'ascending' | 'descending' => {
    if (key !== sortKey) return 'none'
    return sortDir === 'asc' ? 'ascending' : 'descending'
  }

  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return null
    return (
      <span aria-hidden className="ml-1 text-xs text-muted-foreground">
        {sortDir === 'asc' ? '▲' : '▼'}
      </span>
    )
  }

  const onDownloadCsv = () => {
    if (!visibleTips?.length) return

    const header = ['Tipper', 'Article', 'AmountUsd', 'CreatedAt']
    const rows = visibleTips.map((tip) => {
      const createdAtIso = new Date(tip.createdAt).toISOString()
      return [
        getTipperName(tip),
        tip.articleTitle,
        tip.amountUsd.toFixed(2),
        createdAtIso,
      ]
    })

    const csv = [header, ...rows]
      .map((fields) => fields.map((f) => csvEscape(f)).join(','))
      .join('\r\n')
      .concat('\r\n')

    const date = new Date().toISOString().slice(0, 10)
    downloadCsv({ filename: `tip-history-${date}.csv`, csv })
  }

  return (
    <Card variant="quiet" className="overflow-hidden">
      <CardContent className="p-0">
      <div className="p-6 border-b border-border">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold">Recent Tips</h3>
          {list ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-2 md:hidden">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Sort by</span>
                  <select
                    className="h-8 rounded-md border border-border bg-background px-2 text-foreground"
                    value={sortKey}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    aria-label="Sort tips by"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setSort(sortKey)}
                  className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted"
                  aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
                >
                  {sortDir === 'asc' ? 'Ascending' : 'Descending'}
                </button>
              </div>
              <button
                type="button"
                onClick={onDownloadCsv}
                className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted"
              >
                Download CSV
              </button>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows</span>
                <select
                  className="h-8 rounded-md border border-border bg-background px-2 text-foreground"
                  value={pageSize}
                  onChange={(e) => {
                    const value = e.target.value
                    setPageSize(
                      value === 'all' ? 'all' : (Number(value) as 10 | 25 | 50)
                    )
                  }}
                  aria-label="Rows per page"
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="all">All</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </div>
      {visibleTips ? (
        <>
          <div
            data-testid="tip-history-mobile-list"
            className="md:hidden divide-y divide-border"
          >
            {visibleTips.map((tip) => (
              <div key={tip._id} className="p-4 hover:bg-muted/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground line-clamp-2">
                      {tip.articleTitle}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground truncate">
                      {getTipperName(tip)}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold text-success-foreground">
                    +${tip.amountUsd.toFixed(2)}
                  </p>
                </div>
                <div className="mt-2">
                  <TipDateTime createdAt={tip.createdAt} />
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th
                    scope="col"
                    aria-sort={ariaSort('tipper')}
                    className="px-4 py-3 text-left font-medium text-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => setSort('tipper')}
                      className="inline-flex items-center hover:underline"
                    >
                      Tipper{sortIndicator('tipper')}
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={ariaSort('articleTitle')}
                    className="px-4 py-3 text-left font-medium text-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => setSort('articleTitle')}
                      className="inline-flex items-center hover:underline"
                    >
                      Article{sortIndicator('articleTitle')}
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={ariaSort('amountUsd')}
                    className="px-4 py-3 text-right font-medium text-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => setSort('amountUsd')}
                      className="inline-flex items-center hover:underline"
                    >
                      Amount{sortIndicator('amountUsd')}
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={ariaSort('createdAt')}
                    className="px-4 py-3 text-right font-medium text-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => setSort('createdAt')}
                      className="inline-flex items-center hover:underline"
                    >
                      Date{sortIndicator('createdAt')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleTips.map((tip) => (
                  <tr key={tip._id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {getTipperName(tip)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {tip.articleTitle}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-success-foreground">
                      +${tip.amountUsd.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TipDateTime createdAt={tip.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <p className="font-medium text-foreground">No tips yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            When readers tip your work, they will show up here.
          </p>
        </div>
      )}
      </CardContent>
    </Card>
  )
}
