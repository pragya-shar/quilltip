/** @vitest-environment jsdom */
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, it, expect } from 'vitest'
import { WritingPreview } from './WritingPreview'
afterEach(cleanup)
it('keeps paragraph alignment and image captions in preview', () => {
  render(
    <WritingPreview
      content={{
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { textAlign: 'center' },
            content: [{ type: 'text', text: 'Centered words' }],
          },
          {
            type: 'resizableImage',
            attrs: {
              src: 'https://example.com/image.png',
              alt: 'A window',
              title: 'Morning light',
            },
          },
        ],
      }}
    />
  )
  expect(screen.getByText('Centered words')).toHaveStyle({
    textAlign: 'center',
  })
  expect(screen.getByText('Morning light').tagName).toBe('FIGCAPTION')
})
