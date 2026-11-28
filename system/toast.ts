/**
 * Toasts: short confirmations that float above the navigation. The shell
 * mounts one ToastRegion; anything calls `showToast`. At most three show;
 * the oldest leaves first.
 *
 * Timing: 4 s, or 6 s with an action; hover or focus pauses it. A failure
 * is announced assertively, everything else politely.
 */
export type ToastTone = 'done' | 'failure' | 'info'

export type ToastInput = {
  title: string
  description?: string
  tone?: ToastTone
  action?: { label: string; onAction: () => void }
}

export type ToastItem = ToastInput & { id: number; tone: ToastTone }

type Listener = (items: readonly ToastItem[]) => void

const MAX = 3
let items: readonly ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener(items)
}

export function showToast(input: ToastInput): number {
  const id = nextId++
  items = [...items, { ...input, tone: input.tone ?? 'info', id }].slice(-MAX)
  emit()
  return id
}

export function dismissToast(id: number) {
  if (!items.some((item) => item.id === id)) return
  items = items.filter((item) => item.id !== id)
  emit()
}

export const toastStore = {
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get: () => items,
}

export function toastDuration(item: ToastInput): number {
  return item.action ? 6000 : 4000
}
