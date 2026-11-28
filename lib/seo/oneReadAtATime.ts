/**
 * At most one read in flight and one queued per key (#630), for the proxy's
 * route check. Many requests for the same page at once (link prefetches, a
 * burst of readers) then cost at most two backend reads at a time.
 *
 * A request never joins a read that is already running: that read may have
 * started before the request arrived, so its answer could predate a change
 * the request must see (an article hidden in between, #613). Instead, a
 * request that arrives while a read runs waits for the next read, which
 * starts when the running one ends, so after the request arrived. Every
 * request still gets an answer read after it arrived. A failure is shared:
 * when the running read fails, the requests waiting for the next read fail
 * with it, without a new read.
 *
 * `first` says whether this call launched its read at once (true) or waits
 * for the next read (false), so a caller can tell a backend that is slow from
 * time spent waiting in the queue.
 */
export function oneReadAtATime<T>() {
  type Waiting = {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (error: unknown) => void
  }
  type Slot = { next: Waiting | null; start: () => Promise<T> }
  const slots = new Map<string, Slot>()

  const launch = (key: string, slot: Slot): Promise<T> => {
    const read = slot.start()
    const settle = (failure?: { error: unknown }) => {
      const waiting = slot.next
      if (!waiting) {
        slots.delete(key)
        return
      }
      slot.next = null
      // A failed read fails its waiters too: a failure reveals nothing, so
      // the rule above still holds, and a dead backend is seen at once.
      if (failure) {
        slots.delete(key)
        waiting.reject(failure.error)
        return
      }
      launch(key, slot).then(waiting.resolve, waiting.reject)
    }
    read.then(
      () => settle(),
      (error: unknown) => settle({ error })
    )
    return read
  }

  return (
    key: string,
    start: () => Promise<T>
  ): { result: Promise<T>; first: boolean } => {
    const slot = slots.get(key)
    if (!slot) {
      const fresh: Slot = { next: null, start }
      slots.set(key, fresh)
      return { result: launch(key, fresh), first: true }
    }
    if (!slot.next) {
      let resolve!: (value: T) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<T>((yes, no) => {
        resolve = yes
        reject = no
      })
      slot.next = { promise, resolve, reject }
      // The queued read is made by a request that is waiting for it.
      slot.start = start
    }
    return { result: slot.next.promise, first: false }
  }
}
