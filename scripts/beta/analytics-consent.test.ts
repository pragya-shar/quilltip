// @vitest-environment happy-dom
/**
 * Page-speed reporting and consent: nothing is measured or sent before a
 * visitor chooses, or after "No thanks". After "Allow", a `web_vital` event
 * carries only the fixed properties.
 */
import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const reporterMounts = vi.fn()
// Reporter imports started by the next/dynamic stand-in, so a test can wait
// for them to finish instead of counting timer ticks.
const reporterLoads: Promise<unknown>[] = []

vi.mock('../../components/analytics/analytics.css', () => ({}))
vi.mock('next/navigation', () => ({ usePathname: () => '/articles' }))
vi.mock('next/link', () => ({
  default: (props: Record<string, unknown>) => createElement('a', props),
}))
// next/dynamic loads the reporter on demand; here it loads at once.
vi.mock('next/dynamic', () => ({
  default: (load: () => Promise<React.ComponentType>) =>
    function Dynamic() {
      const [Loaded, setLoaded] = useState<React.ComponentType | null>(null)
      useEffect(() => {
        const loading = load().then((component) => setLoaded(() => component))
        reporterLoads.push(loading)
      }, [])
      return Loaded ? createElement(Loaded) : null
    },
}))
// One measurement per mounted reporter, as Next.js reports buffered entries.
vi.mock('next/web-vitals', () => ({
  useReportWebVitals: (
    report: (metric: { name: string; value: number; rating: string }) => void
  ) => {
    useEffect(() => {
      reporterMounts()
      report({ name: 'LCP', value: 1873.4, rating: 'good' })
    }, [report])
  },
}))

const sent: {
  event: string
  path: string
  properties: Record<string, unknown>
}[] = []
let root: Root
let container: HTMLElement

async function flush() {
  for (let index = 0; index < 5; index++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

/** Lets every started reporter import finish and render. */
async function settle() {
  await flush()
  await act(async () => {
    await Promise.all(reporterLoads)
  })
  await flush()
}

async function renderConsent() {
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENABLED', 'true')
  vi.resetModules()
  const { AnalyticsConsent } =
    await import('../../components/analytics/AnalyticsConsent')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(AnalyticsConsent)))
  await flush()
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === name
  )
  if (!found) throw new Error(`No ${name} button`)
  return found
}

beforeEach(() => {
  sent.length = 0
  reporterLoads.length = 0
  reporterMounts.mockClear()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/articles?email=someone@example.com')
  vi.stubGlobal('navigator', {
    ...navigator,
    doNotTrack: null,
    sendBeacon: (_url: string, body: string) => {
      sent.push(JSON.parse(body))
      return true
    },
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('before a choice, nothing is measured or sent', async () => {
  await renderConsent()
  await settle()
  expect(container.textContent).toContain('Allow')
  expect(reporterMounts).not.toHaveBeenCalled()
  expect(sent).toEqual([])
})

test('after "No thanks", nothing is measured or sent', async () => {
  await renderConsent()
  await act(async () => button('No thanks').click())
  await settle()
  expect(reporterMounts).not.toHaveBeenCalled()
  expect(sent).toEqual([])
})

test('after "Allow", web_vital carries the fixed properties only', async () => {
  await renderConsent()
  await act(async () => button('Allow').click())
  // The reporter loads on demand; wait for it rather than a fixed number of
  // ticks, which a busy machine can outrun.
  await vi.waitFor(() => expect(reporterMounts).toHaveBeenCalledTimes(1), {
    timeout: 5000,
  })
  await settle()
  expect(reporterMounts).toHaveBeenCalledTimes(1)
  const vital = sent.find((event) => event.event === 'web_vital')
  expect(vital?.path).toBe('/articles')
  expect(vital?.properties).toEqual({
    metric: 'LCP',
    rating: 'good',
    band: '1500-1999',
    route: 'articles',
    device: window.innerWidth < 768 ? 'mobile' : 'desktop',
  })
})

test('track sends nothing without consent, even when called', async () => {
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENABLED', 'true')
  vi.resetModules()
  const { activateAnalytics, track } = await import('../../lib/analytics/track')
  const { writeConsent } = await import('../../lib/analytics/consent')
  activateAnalytics()
  track('web_vital', { metric: 'LCP' })
  writeConsent('denied')
  track('web_vital', { metric: 'LCP' })
  expect(sent).toEqual([])
  writeConsent('granted')
  track('web_vital', { metric: 'LCP' })
  expect(sent).toHaveLength(1)
})
