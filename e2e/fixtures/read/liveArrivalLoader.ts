// The read suite's stand-in for the Write package's arrival loader: a
// marked panel with Done, so the suite can see when the arrival runs.
import { createElement } from 'react'
import type {
  LiveArrivalModule,
  LiveArrivalProps,
} from '../../../components/read/liveArrivalLoader'

export type { LiveArrivalModule, LiveArrivalProps }

function FixtureArrival({
  articleId,
  title,
  lineHref,
  done,
}: LiveArrivalProps) {
  return createElement(
    'div',
    { 'data-testid': 'live-arrival' },
    `Live: ${articleId} · ${title.textContent} · ${lineHref(1, 0)} `,
    createElement('button', { type: 'button', onClick: done }, 'Done')
  )
}

export const loadLiveArrival: () => Promise<LiveArrivalModule> = async () => ({
  default: FixtureArrival,
})
