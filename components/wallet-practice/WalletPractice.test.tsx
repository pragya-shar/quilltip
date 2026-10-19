/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import WalletPractice from './WalletPractice'
const state = vi.hoisted(() => ({
  error: 'Freighter is not available in this browser.',
  status: 'unknown',
}))
vi.mock('@/lib/stellar/practice', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  makeKit: async () => {
    throw new Error(state.error)
  },
  checkPractice: async () => state.status,
}))
describe('prototype wallet practice', () => {
  beforeEach(() => {
    localStorage.clear()
    history.replaceState({}, '', '/wallet/practice?returnTo=%2F%23try-it')
  })
  it('selects the requested wallet and reports a connection failure without a success receipt', async () => {
    const user = userEvent.setup()
    render(<WalletPractice />)
    await user.click(screen.getByRole('button', { name: 'xBull' }))
    await user.click(screen.getByRole('button', { name: 'Connect xBull' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Freighter is not available'
    )
    expect(
      screen.queryByText('Signed. Sent. Received.')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute(
      'href',
      '/#try-it'
    )
  })
  it('restores an unknown transfer with status checking and no second-send action', async () => {
    localStorage.setItem(
      'quilltip-testnet-practice-v1',
      JSON.stringify({
        hash: 'a'.repeat(64),
        address: 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR',
        expires: Date.now() + 100000,
        status: 'confirmed',
      })
    )
    render(<WalletPractice />)
    await waitFor(() =>
      expect(screen.getByText('Checking your transfer.')).toBeInTheDocument()
    )
    expect(
      screen.queryByRole('button', {
        name: /Start another|Connect Freighter|Approve 1/,
      })
    ).not.toBeInTheDocument()
  })
  it('rejects off-site return URLs', () => {
    history.replaceState({}, '', '/wallet/practice?returnTo=%2F%2Fevil.example')
    render(<WalletPractice />)
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute(
      'href',
      '/#try-it'
    )
  })
})
