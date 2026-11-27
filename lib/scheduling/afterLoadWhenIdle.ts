/**
 * Runs `task` once the browser is idle after the load event, so it never
 * competes with first paint or with the page's own resources. Returns a
 * cleanup function that cancels the task if it has not run.
 */
export function afterLoadWhenIdle(task: () => void): () => void {
  let idle: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if ('requestIdleCallback' in window) {
      idle = window.requestIdleCallback(task, { timeout: 1500 })
    } else {
      timer = setTimeout(task, 200)
    }
  }
  if (document.readyState === 'complete') schedule()
  else window.addEventListener('load', schedule, { once: true })
  return () => {
    window.removeEventListener('load', schedule)
    if (idle !== undefined) window.cancelIdleCallback(idle)
    if (timer !== undefined) clearTimeout(timer)
  }
}
