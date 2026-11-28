import { expect, test } from 'vitest'
import { handleFormatError } from '../../lib/profile/handleRules'
import { publicContentPath } from '../../lib/routing/publicContentPath'
import { NO_SUCH_HANDLE } from '../../lib/seo/readingListState'

/**
 * The /articles outage signal looks up a handle that no writer can have
 * (#609). It must stay impossible by the handle rules, not by luck: if a
 * later change to the rules allowed it, a real writer could own it.
 */
test('the reading list check uses a handle the handle rules reject', () => {
  expect(handleFormatError(NO_SUCH_HANDLE)).not.toBeNull()
  expect(publicContentPath(`/${NO_SUCH_HANDLE}`)).toBeNull()
  expect(publicContentPath(`/${encodeURIComponent(NO_SUCH_HANDLE)}`)).toBeNull()
})
