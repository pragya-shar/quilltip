/**
 * The shell's sheet stack: sheets that open over whatever the person is
 * doing and never navigate away (the Pocket, and the money acts and sign-in
 * that the surfaces add). It lives in the shell, so a sheet survives a
 * change of place. `SheetHost` renders it.
 *
 * To add a sheet: add its id to `SheetId` and its component to
 * `shell/SheetHost.tsx`.
 */
export type SheetId = 'pocket'

export type SheetEntry = { key: number; id: SheetId; open: boolean }

type Listener = () => void

/** Time the exit animation needs before an entry leaves the stack. */
const EXIT_MS = 220

let entries: readonly SheetEntry[] = []
let nextKey = 1
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((listener) => listener())

export const sheetStack = {
  get: () => entries,
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  /** Opens a sheet on top. A sheet already open is not opened twice. */
  open(id: SheetId) {
    if (entries.some((entry) => entry.id === id && entry.open)) return
    entries = [...entries, { key: nextKey++, id, open: true }]
    emit()
  },
  /** Closes the topmost open sheet with this id (or the top one). */
  close(id?: SheetId) {
    const target = [...entries]
      .reverse()
      .find((entry) => entry.open && (id === undefined || entry.id === id))
    if (!target) return
    entries = entries.map((entry) =>
      entry.key === target.key ? { ...entry, open: false } : entry
    )
    emit()
    setTimeout(() => {
      entries = entries.filter((entry) => entry.key !== target.key)
      emit()
    }, EXIT_MS)
  },
  toggle(id: SheetId) {
    if (entries.some((entry) => entry.id === id && entry.open))
      sheetStack.close(id)
    else sheetStack.open(id)
  },
  isOpen: (id: SheetId) =>
    entries.some((entry) => entry.id === id && entry.open),
}
