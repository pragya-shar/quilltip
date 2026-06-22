/** @vitest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import SearchInput from '@/components/articles/SearchInput'

function renderWithLabel() {
  return render(
    <>
      <label htmlFor="articles-browse-search">Search articles</label>
      <SearchInput
        id="articles-browse-search"
        value=""
        onChange={vi.fn()}
        debounceMs={300}
      />
    </>
  )
}

describe('SearchInput debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not call onChange before the debounce delay', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} debounceMs={300} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 't' } })
    fireEvent.change(input, { target: { value: 'te' } })
    fireEvent.change(input, { target: { value: 'tes' } })
    fireEvent.change(input, { target: { value: 'test' } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('calls onChange exactly once with the final value after rapid typing', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} debounceMs={300} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 't' } })
    fireEvent.change(input, { target: { value: 'te' } })
    fireEvent.change(input, { target: { value: 'tes' } })
    fireEvent.change(input, { target: { value: 'test' } })

    act(() => vi.advanceTimersByTime(300))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('test')
  })

  it('calls onChange for each character when typing slowly (>=300ms apart)', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} debounceMs={300} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 't' } })
    act(() => vi.advanceTimersByTime(300))

    fireEvent.change(input, { target: { value: 'te' } })
    act(() => vi.advanceTimersByTime(300))

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenNthCalledWith(1, 't')
    expect(onChange).toHaveBeenNthCalledWith(2, 'te')
  })

  it('calls onChange immediately when the clear button is clicked, cancelling any pending timer', () => {
    const onChange = vi.fn()
    render(<SearchInput value="test" onChange={onChange} debounceMs={300} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 'tests' } })

    const clearButton = screen.getByRole('button', { name: /clear search/i })
    fireEvent.click(clearButton)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('')

    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not fire stale intermediate values when backspacing quickly', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} debounceMs={300} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 'test' } })
    fireEvent.change(input, { target: { value: 'tes' } })
    fireEvent.change(input, { target: { value: 'te' } })

    act(() => vi.advanceTimersByTime(300))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('te')
  })

  it('cancels pending timer on unmount', () => {
    const onChange = vi.fn()
    const { unmount } = render(
      <SearchInput value="" onChange={onChange} debounceMs={300} />
    )
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 'test' } })
    unmount()

    act(() => vi.advanceTimersByTime(300))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SearchInput controlled value sync', () => {
  it('updates displayed value when the value prop changes externally', () => {
    const { rerender } = render(<SearchInput value="foo" onChange={vi.fn()} />)
    expect(screen.getByRole('textbox')).toHaveValue('foo')

    rerender(<SearchInput value="bar" onChange={vi.fn()} />)
    expect(screen.getByRole('textbox')).toHaveValue('bar')
  })
})

describe('SearchInput accessibility', () => {
  it('keeps the visible label when the user types', () => {
    renderWithLabel()
    const input = screen.getByLabelText('Search articles')

    expect(screen.getByText('Search articles')).toBeVisible()
    fireEvent.change(input, { target: { value: 'stellar' } })
    expect(screen.getByText('Search articles')).toBeVisible()
    expect(input).toHaveValue('stellar')
  })

  it('associates the input with an external label via id', () => {
    renderWithLabel()
    expect(screen.getByLabelText('Search articles')).toHaveAttribute(
      'id',
      'articles-browse-search'
    )
  })

  it('renders decorative icons as aria-hidden', () => {
    const { container } = render(
      <SearchInput value="query" onChange={vi.fn()} />
    )
    const icons = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(icons.length).toBeGreaterThanOrEqual(2)
  })

  it('exposes the clear button as type button with an accessible name', () => {
    render(<SearchInput value="test" onChange={vi.fn()} />)
    const clearButton = screen.getByRole('button', { name: /clear search/i })
    expect(clearButton).toHaveAttribute('type', 'button')
  })

  it('clears search when the clear button is activated with Enter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchInput value="test" onChange={onChange} debounceMs={300} />)

    const clearButton = screen.getByRole('button', { name: /clear search/i })
    clearButton.focus()
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('clears search when the clear button is activated with Space', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchInput value="test" onChange={onChange} debounceMs={300} />)

    const clearButton = screen.getByRole('button', { name: /clear search/i })
    clearButton.focus()
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByRole('textbox')).toHaveValue('')
  })
})
