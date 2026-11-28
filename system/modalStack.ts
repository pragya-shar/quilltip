/**
 * The open modal dialogs, in order. A modal makes the rest of the page inert
 * and sits in the top layer, so anything that must stay usable above it (the
 * toast region) moves into the topmost one.
 */
type Listener = () => void

let stack: readonly HTMLDialogElement[] = []
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((listener) => listener())

export const modalStack = {
  push(dialog: HTMLDialogElement) {
    stack = [...stack.filter((d) => d !== dialog), dialog]
    emit()
  },
  remove(dialog: HTMLDialogElement) {
    if (!stack.includes(dialog)) return
    stack = stack.filter((d) => d !== dialog)
    emit()
  },
  top: (): HTMLDialogElement | null => stack.at(-1) ?? null,
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
