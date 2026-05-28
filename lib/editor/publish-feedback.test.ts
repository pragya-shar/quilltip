import { describe, expect, it } from 'vitest'
import {
  PUBLISH_EMPTY_CONTENT_FEEDBACK,
  publishErrorFeedback,
} from './publish-feedback'

describe('publish-feedback', () => {
  it('defines empty content feedback', () => {
    expect(PUBLISH_EMPTY_CONTENT_FEEDBACK.title).toMatch(/content/i)
  })

  it('maps errors to destructive feedback', () => {
    expect(publishErrorFeedback(new Error('Offline')).detail).toBe('Offline')
    expect(publishErrorFeedback('x').detail).toBe('Unknown error')
  })
})
