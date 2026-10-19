/** @vitest-environment jsdom */
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest'
import WalletPractice from './WalletPractice'
const state = vi.hoisted(() => ({
  mode: 'success',
  status: 'unknown',
  atSubmission: null as { hash: string } | null,
}))
vi.mock('@/lib/stellar/practice', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/stellar/practice')>()
  const { Buffer } = await import('node:buffer')
  vi.stubGlobal(
    'Uint8Array',
    Object.getPrototypeOf(Buffer.prototype).constructor
  )
  const sdk = await import('@stellar/stellar-sdk')
  const pair = sdk.Keypair.random()
  return {
    ...original,
    makeKit: async () => ({
      setWallet: () => {},
      getAddress: async () => ({ address: pair.publicKey() }),
      getNetwork: async () => ({ networkPassphrase: sdk.Networks.TESTNET }),
      signTransaction: async (xdr: string) => {
        const tx = sdk.TransactionBuilder.fromXDR(xdr, sdk.Networks.TESTNET)
        tx.sign(pair)
        return { signedTxXdr: tx.toXDR() }
      },
    }),
    server: {
      loadAccount: async (address: string) =>
        Object.assign(new sdk.Account(address, '1'), {
          balances: [{ asset_type: 'native', balance: '100' }],
        }),
      submitTransaction: async () => {
        state.atSubmission = JSON.parse(
          localStorage.getItem(original.PENDING_KEY)!
        )
        if (state.mode === 'timeout') throw new Error('Network timeout')
        return { successful: true }
      },
    },
    checkPractice: async () => state.status,
  }
})
beforeEach(() => {
  localStorage.clear()
  state.mode = 'success'
  state.status = 'unknown'
  state.atSubmission = null
  history.replaceState({}, '', '/wallet/practice')
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (
        _n: string,
        _o: unknown,
        callback: (lock: object) => Promise<void>
      ) => callback({}),
    },
  })
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => vi.unstubAllGlobals())
it('persists the signed hash before submission and shows confirmation only after the response', async () => {
  const user = userEvent.setup()
  render(<WalletPractice />)
  await user.click(screen.getByRole('button', { name: 'Connect Freighter' }))
  await user.click(
    await screen.findByRole('button', { name: 'Approve 1 test XLM in wallet' })
  )
  expect(await screen.findByText('Signed. Sent. Received.')).toBeInTheDocument()
  const saved = JSON.parse(
    localStorage.getItem('quilltip-testnet-practice-v1')!
  )
  expect(state.atSubmission?.hash).toBe(saved.hash)
  expect(saved.status).toBe('confirmed')
})
it('retains an ambiguous submission and recovers it through status checking', async () => {
  state.mode = 'timeout'
  const user = userEvent.setup()
  render(<WalletPractice />)
  await user.click(screen.getByRole('button', { name: 'Connect Freighter' }))
  await user.click(
    await screen.findByRole('button', { name: 'Approve 1 test XLM in wallet' })
  )
  expect(await screen.findByText('Checking your transfer.')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Start another practice' })
  ).not.toBeInTheDocument()
  state.status = 'confirmed'
  await user.click(screen.getByRole('button', { name: 'Check status' }))
  expect(await screen.findByText('Signed. Sent. Received.')).toBeInTheDocument()
})
it('does not submit when it cannot save the recovery hash', async () => {
  const user = userEvent.setup()
  render(<WalletPractice />)
  await user.click(screen.getByRole('button', { name: 'Connect Freighter' }))
  await screen.findByRole('button', { name: 'Approve 1 test XLM in wallet' })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked')
  })
  await user.click(
    screen.getByRole('button', { name: 'Approve 1 test XLM in wallet' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage blocked')
  expect(state.atSubmission).toBeNull()
  expect(screen.queryByText('Signed. Sent. Received.')).not.toBeInTheDocument()
})
it('moves two already-open screens to recovery when another context saves an attempt', async () => {
  render(
    <>
      <WalletPractice />
      <WalletPractice />
    </>
  )
  const value = JSON.stringify({
    hash: 'b'.repeat(64),
    address: 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR',
    expires: Date.now() + 100000,
    status: 'unknown',
  })
  localStorage.setItem('quilltip-testnet-practice-v1', value)
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'quilltip-testnet-practice-v1',
        newValue: value,
      })
    )
  )
  await waitFor(() =>
    expect(screen.getAllByText('Checking your transfer.')).toHaveLength(2)
  )
  expect(
    screen.queryByRole('button', { name: 'Connect Freighter' })
  ).not.toBeInTheDocument()
})
