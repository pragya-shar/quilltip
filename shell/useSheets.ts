'use client'

import { useSyncExternalStore } from 'react'
import { sheetStack, type SheetEntry } from './sheetStack'

const none: readonly SheetEntry[] = []

/** The open sheets, for the host and for items that show open state. */
export function useSheets(): readonly SheetEntry[] {
  return useSyncExternalStore(sheetStack.subscribe, sheetStack.get, () => none)
}
