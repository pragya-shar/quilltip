/**
 * First path segments that belong to the application, not to writers:
 * `/<segment>` is never read as `/<handle>`. One file per package; a package
 * adds the top-level segment of every route it adds, in its own file.
 * scripts/system/reserved-segments.test.ts fails when a top-level route
 * under app/(app) or app/(legacy) is not reserved here.
 */
import { segments as foundation } from './foundation'
import { segments as legacy } from './legacy'
import { segments as ops } from './ops'
import { segments as pocket } from './pocket'
import { segments as read } from './read'
import { segments as resources } from './resources'
import { segments as search } from './search'
import { segments as shelf } from './shelf'
import { segments as signin } from './signin'
import { segments as today } from './today'
import { segments as write } from './write'
import { segments as writer } from './writer'
import { segments as you } from './you'

export const SEGMENT_PACKAGES = {
  foundation,
  legacy,
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
} satisfies Record<string, readonly string[]>

export const RESERVED_SEGMENTS: readonly string[] = [
  ...new Set(Object.values(SEGMENT_PACKAGES).flat()),
].sort()
