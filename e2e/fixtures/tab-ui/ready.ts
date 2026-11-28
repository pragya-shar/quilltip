import { expect, type Page } from '@playwright/test'

type BootStep = { step: string; ms: number }

/**
 * Waits for the fixture page to show `fixture-state`, with the default
 * expect timeout as before. When the page is late, the error names the
 * start-up steps it reached and when (`noteBoot` in session.ts), with the
 * navigation and script timings, so a retry in CI says which step waited
 * (#658).
 */
export async function expectFixtureReady(page: Page): Promise<void> {
  try {
    await expect(page.getByTestId('fixture-state')).toBeVisible()
  } catch (error) {
    const read = page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined
      const scripts = performance
        .getEntriesByType('resource')
        .map((entry) => entry as PerformanceResourceTiming)
        .filter((entry) => entry.name.endsWith('.js'))
        .map(
          (entry) =>
            `${new URL(entry.name).pathname} ${Math.round(entry.startTime)}-${Math.round(entry.responseEnd)} ms`
        )
      const boot = (window as unknown as { __tabFixtureBoot?: BootStep[] })
        .__tabFixtureBoot
      return [
        `document: ${document.readyState}`,
        nav
          ? `navigation: response ${Math.round(nav.responseEnd)} ms, DOMContentLoaded ${Math.round(nav.domContentLoadedEventEnd)} ms, load ${Math.round(nav.loadEventEnd)} ms`
          : 'navigation: no entry',
        `scripts: ${scripts.join(', ') || 'none'}`,
        `steps: ${boot ? boot.map((b) => `${b.step} @${b.ms} ms`).join(', ') : 'none (the page script did not start)'}`,
      ].join('\n')
    })
    const report = await Promise.race([
      read,
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('the page did not answer within 1 s'), 1000)
      ),
    ]).catch((reason: unknown) => `the page could not be read: ${reason}`)
    throw new Error(
      `The fixture page did not show fixture-state.\n${report}\n\n${(error as Error).message}`,
      { cause: error }
    )
  }
}
