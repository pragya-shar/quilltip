import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { CompactEarningsFigures } from '../../components/dashboard/CompactEarningsFigures'
import { CreatorStatsPanel } from '../../components/dashboard/CreatorStatsPanel'

/**
 * Settled earnings are exact, server-summed figures: they print every stroop
 * and never round up (#676). Only an estimate is rounded, and it says "About".
 */
const EARNED = '1145760615' // 114.5760615 XLM; to 2 decimals it read 114.58

test.each([
  ['the stats panel', CreatorStatsPanel],
  ['the dashboard card', CompactEarningsFigures],
] as const)('%s prints settled earnings at full precision', (_, Component) => {
  const markup = renderToStaticMarkup(
    createElement(
      Component as typeof CreatorStatsPanel,
      {
        articleCount: 3,
        tipsReceivedCount: 9,
        tipCount: 9,
        earnedStroops: EARNED,
        estimatedUsd: 14.87,
        isTestnet: true,
        nftsOwned: 0,
        complete: true,
        unpricedTipCount: 0,
        updating: false,
      } as never
    )
  )
  // The text a reader sees: the figure and its unit may be separate spans.
  const html = markup.replace(/<[^>]+>/g, '')
  expect(html).toContain('114.5760615 XLM')
  expect(html).not.toContain('114.58 XLM')
  expect(html).not.toContain('About')
})
