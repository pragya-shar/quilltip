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
 * request still gets an answer read after it arrived.
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
    const settle = () => {
      const waiting = slot.next
      if (!waiting) {
        slots.delete(key)
        return
      }
      slot.next = null
      launch(key, slot).then(waiting.resolve, waiting.reject)
    }
    read.then(settle, settle)
    return read
  }

  return (key: string, start: () => Promise<T>): Promise<T> => {
    const slot = slots.get(key)
    if (!slot) {
      const fresh: Slot = { next: null, start }
      slots.set(key, fresh)
      return launch(key, fresh)
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
    return slot.next.promise
  }
}
