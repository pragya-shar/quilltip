'use client'

import dynamic from 'next/dynamic'

export type { ChartConfig } from '@/components/ui/chart-shared'
export {
  ChartTooltipContent,
  ChartLegendContent,
  ChartStyle,
  useChart,
} from '@/components/ui/chart-shared'
export { getPayloadConfigFromPayload } from '@/components/ui/chart-shared'

function ChartSkeleton() {
  return (
    <div
      className="flex aspect-video w-full animate-pulse rounded-md bg-muted/40"
      aria-hidden
    />
  )
}

export const ChartContainer = dynamic(
  () =>
    import('@/components/ui/chart-recharts').then((mod) => mod.ChartContainer),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

export const ChartTooltip = dynamic(
  () =>
    import('@/components/ui/chart-recharts').then((mod) => mod.ChartTooltip),
  { ssr: false, loading: () => null }
)

export const ChartLegend = dynamic(
  () => import('@/components/ui/chart-recharts').then((mod) => mod.ChartLegend),
  { ssr: false, loading: () => null }
)
