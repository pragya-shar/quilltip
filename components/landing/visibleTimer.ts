// Count visible time so a background tab never skips the opening's handoff.
export function visibleTimer(
  callback: () => void,
  duration: number,
  doc = document,
  clock = {
    now: () => performance.now(),
    set: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
    clear: (id: number) => window.clearTimeout(id),
  }
) {
  let remaining = duration
  let started = 0
  let timer = 0
  let done = false
  function cancel() {
    done = true
    clock.clear(timer)
    doc.removeEventListener('visibilitychange', change)
  }
  function start() {
    started = clock.now()
    timer = clock.set(() => {
      cancel()
      callback()
    }, remaining)
  }
  function change() {
    if (done) return
    if (doc.hidden) {
      clock.clear(timer)
      remaining = Math.max(0, remaining - (clock.now() - started))
    } else start()
  }
  doc.addEventListener('visibilitychange', change)
  if (!doc.hidden) start()
  return cancel
}
