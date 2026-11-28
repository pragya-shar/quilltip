/**
 * Every check that needs a production build, one file per package. A
 * package adds its file's entries; it never edits the workflow. CI runs them
 * all in one step of the "Production build checks" job
 * (scripts/app-checks/run.ts), against one build and one app.
 */
import type { AppCheck } from './types'
import { checks as foundation } from './foundation'
import { checks as ops } from './ops'
import { checks as pocket } from './pocket'
import { checks as read } from './read'
import { checks as resources } from './resources'
import { checks as search } from './search'
import { checks as shelf } from './shelf'
import { checks as signin } from './signin'
import { checks as today } from './today'
import { checks as write } from './write'
import { checks as writer } from './writer'
import { checks as you } from './you'

export type { AppCheck } from './types'

export const APP_CHECK_PACKAGES = {
  foundation,
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
} satisfies Record<string, readonly AppCheck[]>

export const APP_CHECKS: readonly AppCheck[] =
  Object.values(APP_CHECK_PACKAGES).flat()
