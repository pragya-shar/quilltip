/**
 * Every sheet a surface loads on demand, so any surface can open it before
 * its owner's code has loaded (the tip bar opens the Pocket's "add-money"
 * when the balance is short). Each package owns one file here and edits
 * only that file; the declarations are tiny and import nothing until a
 * sheet opens. Ids are unique across packages (scripts/system/sheets.test.ts).
 */
import type { SheetDeclaration, SheetDeclarations } from './types'
import { sheets as ops } from './ops'
import { sheets as pocket } from './pocket'
import { sheets as read } from './read'
import { sheets as resources } from './resources'
import { sheets as search } from './search'
import { sheets as shelf } from './shelf'
import { sheets as signin } from './signin'
import { sheets as today } from './today'
import { sheets as write } from './write'
import { sheets as writer } from './writer'
import { sheets as you } from './you'

export type { SheetBodyProps, SheetDeclaration } from './types'

export const SHEET_PACKAGES = {
  ops,
  pocket,
  read,
  resources,
  search,
  shelf,
  signin,
  today,
  write,
  writer,
  you,
} satisfies Record<string, SheetDeclarations>

export const SHEET_DECLARATIONS: SheetDeclarations = Object.assign(
  {},
  ...Object.values(SHEET_PACKAGES)
)

export function declaredSheet(
  id: string
): SheetDeclaration<unknown> | undefined {
  return SHEET_DECLARATIONS[id]
}
