/**
 * The rebuilt surfaces' fixture suites. Each package owns one file here and
 * edits only that file; `scripts/fixture-suites.ts` adds these to the suite
 * list, and CI runs them all in one shard (`--suite @surfaces`), in
 * Chromium and WebKit. Ports 4200 and up are for these suites.
 */
import type { FixtureSuite } from './types'
import { suites as ops } from './ops'
import { suites as pocket } from './pocket'
import { suites as read } from './read'
import { suites as resources } from './resources'
import { suites as search } from './search'
import { suites as shelf } from './shelf'
import { suites as signin } from './signin'
import { suites as today } from './today'
import { suites as write } from './write'
import { suites as writer } from './writer'
import { suites as you } from './you'

export type { FixtureSuite } from './types'

export const SURFACE_SUITE_PACKAGES = {
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
} satisfies Record<string, readonly FixtureSuite[]>

export const SURFACE_SUITES: readonly FixtureSuite[] = Object.values(
  SURFACE_SUITE_PACKAGES
).flat()
