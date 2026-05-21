/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageUploadDialog } from '@/components/editor/ImageUploadDialog'
import { UPLOAD_CONTROL_FOCUS_RING } from '@/lib/constants'

vi.mock('convex/react', () => ({
  useConvex: () => ({}),
}))

describe('ImageUploadDialog accessibility', () => {
  it('renders choose file control with focus ring utilities', () => {
    render(
      <ImageUploadDialog
        isOpen
        onClose={vi.fn()}
        onImageSelect={vi.fn()}
      />
    )

    const chooseFileLabel = screen.getByText('Choose file').closest('label')
    expect(chooseFileLabel).not.toBeNull()
    for (const cls of UPLOAD_CONTROL_FOCUS_RING.split(' ')) {
      expect(chooseFileLabel!.className).toContain(cls)
    }
  })

  it('mentions choosing a file in drag-and-drop instructions', () => {
    render(
      <ImageUploadDialog
        isOpen
        onClose={vi.fn()}
        onImageSelect={vi.fn()}
      />
    )

    expect(
      screen.getByText(
        'Drag and drop an image here, or choose a file to upload.'
      )
    ).toBeInTheDocument()
  })

  it('nests sr-only file input inside the choose file label', () => {
    render(
      <ImageUploadDialog
        isOpen
        onClose={vi.fn()}
        onImageSelect={vi.fn()}
      />
    )

    const chooseFileLabel = screen.getByText('Choose file').closest('label')
    const input = chooseFileLabel?.querySelector('#image-file-input')
    expect(input).not.toBeNull()
    expect(input).toHaveAttribute('type', 'file')
    expect(input?.className).toContain('sr-only')
  })
})
