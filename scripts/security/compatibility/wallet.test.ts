// @vitest-environment happy-dom
import {
  Networks,
  Keypair,
  TransactionBuilder,
  Account,
  Operation,
} from '@stellar/stellar-sdk'
import { afterEach, expect, it, vi } from 'vitest'

const wallet = vi.hoisted(() => ({
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
  setWallet: vi.fn(),
}))
vi.mock('../../../lib/stellar/wallet-kit-loader', () => ({
  loadWalletKit: async () => ({
    StellarWalletsKit: class {
      constructor(options: { network: string }) {
        expect(options.network).toBe('Test SDF Network ; September 2015')
      }
      getAddress = wallet.getAddress
      getNetwork = wallet.getNetwork
      signTransaction = wallet.signTransaction
      setWallet = wallet.setWallet
    },
    allowAllModules: () => [],
    WalletNetwork: { TESTNET: 'Test SDF Network ; September 2015' },
  }),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  localStorage.clear()
})

it('connects and forwards valid testnet XDR and passphrase to the signing adapter, including rejection', async () => {
  vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')
  const { walletAdapter, FREIGHTER_ID } =
    await import('../../../lib/stellar/wallet-adapter')
  const key = Keypair.random()
  wallet.getAddress.mockResolvedValue({ address: key.publicKey() })
  wallet.getNetwork.mockResolvedValue({
    network: 'TESTNET',
    networkPassphrase: Networks.TESTNET,
  })
  const connection = await walletAdapter.connectToWallet(FREIGHTER_ID)
  expect(connection.publicKey).toBe(key.publicKey())
  expect(connection.networkPassphrase).toBe(Networks.TESTNET)
  expect(wallet.setWallet).toHaveBeenCalledWith(FREIGHTER_ID)

  // Sign locally with a throwaway key; never submit a transaction to a network.
  const tx = new TransactionBuilder(new Account(key.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.manageData({ name: 'local-compatibility', value: 'test' })
    )
    .setTimeout(30)
    .build()
  const unsigned = tx.toXDR()
  tx.sign(key)
  wallet.signTransaction.mockResolvedValue({ signedTxXdr: tx.toXDR() })
  const signed = await walletAdapter.signTransaction(unsigned, Networks.TESTNET)
  expect(wallet.signTransaction).toHaveBeenCalledWith(unsigned, {
    address: key.publicKey(),
    networkPassphrase: Networks.TESTNET,
  })
  const parsed = TransactionBuilder.fromXDR(signed, Networks.TESTNET)
  expect(key.verify(parsed.hash(), parsed.signatures[0]!.signature())).toBe(
    true
  )
  wallet.signTransaction.mockRejectedValue(new Error('User declined'))
  await expect(
    walletAdapter.signTransaction(unsigned, Networks.TESTNET)
  ).rejects.toThrow('Transaction signature rejected by user')
  walletAdapter.disconnect()
  expect(await walletAdapter.isConnected()).toBe(false)
})
