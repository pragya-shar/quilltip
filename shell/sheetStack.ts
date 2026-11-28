/**
 * The shell's sheet stack: sheets that open over whatever the person is
 * doing and never navigate away (the Pocket, and the money acts and sign-in
 * that the surfaces add). It lives in the shell; `SheetHost` renders it and
 * closes every open sheet when the path changes, so a link followed from a
 * sheet never leaves the sheet over the new page.
 *
 * The Pocket is the shell's own sheet. A surface adds its sheets with
 * `registerSheet` (shell/sheetRegistry.ts) and opens them here.
 */
import { sheetFor } from './sheetRegistry'
import { declaredSheet } from './sheets'

export type SheetId = 'pocket' | (string & {})

/** Whether the shell can draw this sheet now. */
export function knownSheet(id: SheetId): boolean {
  return id === 'pocket' || Boolean(sheetFor(id)) || Boolean(declaredSheet(id))
}

export type SheetEntry = {
  key: number
  id: SheetId
  open: boolean
  /** What the sheet was opened with, passed to its component. */
  props: unknown
}

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
  /**
   * Opens a sheet on top: the Pocket, a sheet registered by loaded code, or
   * one declared in shell/sheets (loaded now). A sheet already open is not
   * opened twice.
   */
  open(id: SheetId, props?: unknown): boolean {
    // An id that is neither the Pocket, registered nor declared is refused:
    // an entry nobody can draw would stay open and hidden.
    if (!knownSheet(id)) {
      if (process.env.NODE_ENV !== 'production')
        console.warn(
          `sheetStack.open: no sheet "${id}" is registered or declared.`
        )
      return false
    }
    if (entries.some((entry) => entry.id === id && entry.open)) return true
    entries = [...entries, { key: nextKey++, id, open: true, props }]
    emit()
    return true
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
  /** Closes every open sheet: the place changed under them. */
  closeAll() {
    const open = entries.filter((entry) => entry.open)
    if (open.length === 0) return
    const keys = new Set(open.map((entry) => entry.key))
    entries = entries.map((entry) =>
      keys.has(entry.key) ? { ...entry, open: false } : entry
    )
    emit()
    setTimeout(() => {
      entries = entries.filter((entry) => !keys.has(entry.key))
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
