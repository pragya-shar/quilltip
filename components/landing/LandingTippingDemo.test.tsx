/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LandingTippingDemo } from './LandingTippingDemo'

describe('Landing reading sample', () => {
  it('lets readers choose a sentence and previews only that passage in a labelled demo receipt', async () => {
    const user = userEvent.setup()
    render(<LandingTippingDemo />)
    const sentence = screen.getByRole('button', {
      name: 'Sometimes, a stranger finds the words we could not find for ourselves.',
    })
    await user.click(sentence)
    expect(sentence).toHaveAttribute('aria-pressed', 'true')
    await user.click(
      screen.getByRole('button', { name: 'Appreciate for free' })
    )
    const receipt = screen.getByRole('region', { name: 'A note for Maya' })
    expect(
      within(receipt).getByText(/Sometimes, a stranger/)
    ).toBeInTheDocument()
    expect(within(receipt).getByText(/Demo receipt/)).toBeInTheDocument()
    expect(screen.getByText(/no transaction sent/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Continue reading/ })
    ).toHaveAttribute('href', '/articles')
  })
  it('supports keyboard selection and resets the receipt when choosing another sentence', async () => {
    const user = userEvent.setup()
    render(<LandingTippingDemo />)
    await user.click(
      screen.getByRole('button', { name: 'Appreciate for free' })
    )
    const sentence = screen.getByRole('button', {
      name: 'There are words we read, and words we carry.',
    })
    sentence.focus()
    await user.keyboard('{Enter}')
    expect(sentence).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.queryByRole('region', { name: 'A note for Maya' })
    ).not.toBeInTheDocument()
  })
})

it('returns keyboard focus to the chosen sentence when retry removes the receipt', async () => {
  const user = userEvent.setup()
  render(<LandingTippingDemo />)
  await user.click(screen.getByRole('button', { name: 'Appreciate for free' }))
  await user.click(screen.getByRole('button', { name: 'Read another line' }))
  expect(
    screen.getByRole('button', {
      name: 'A sentence can feel like a hand on your shoulder, a window left open, a small permission to begin again.',
    })
  ).toHaveFocus()
})

it('previews the selected demo amount and passes the same passage to the writer receipt', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    },
  })
  const onReceipt = vi.fn()
  const user = userEvent.setup()
  render(<LandingTippingDemo onReceipt={onReceipt} />)
  await user.click(
    screen.getByRole('button', {
      name: 'Sometimes, a stranger finds the words we could not find for ourselves.',
    })
  )
  await user.click(screen.getByRole('button', { name: 'Add a tip' }))
  const dialog = within(
    screen.getByRole('dialog', { name: 'Preview a little appreciation.' })
  )
  await user.click(dialog.getByRole('radio', { name: '5 test XLM' }))
  await user.click(
    dialog.getByRole('button', { name: 'Preview 5 test XLM receipt' })
  )
  expect(onReceipt).toHaveBeenLastCalledWith({
    amount: '5',
    words:
      'Sometimes, a stranger finds the words we could not find for ourselves.',
  })
  const receipt = screen.getByRole('region', { name: 'A note for Maya' })
  expect(receipt).toHaveFocus()
  expect(within(receipt).getByText('5 test XLM')).toBeInTheDocument()
  expect(within(receipt).getByText(/nothing sent or saved/)).toBeInTheDocument()
})
