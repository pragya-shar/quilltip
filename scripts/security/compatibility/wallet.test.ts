// @vitest-environment happy-dom
import {
  Networks,
  Keypair,
  TransactionBuilder,
  Account,
  Operation,
} from '@stellar/stellar-sdk'
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk'
import {
  KitEventType,
  ModuleType,
  type ModuleInterface,
} from '@creit.tech/stellar-wallets-kit/types'
import { expect, it } from 'vitest'
import {
  createWalletAdapter,
  type KitBundle,
} from '../../../lib/stellar/v2/wallet'
import { isWalletError } from '../../../lib/stellar/v2/wallet-errors'

/**
 * Drives the real Stellar Wallets Kit 2.x static API through the adapter with
 * an in-memory wallet module. Signing uses a throwaway key; nothing is sent to
 * a network.
 */
class LocalWallet implements ModuleInterface {
  moduleType = ModuleType.HOT_WALLET
  productId = 'local-test'
  productName = 'Local test wallet'
  productUrl = 'https://example.test'
  productIcon = ''
  passphrase: string = Networks.TESTNET
  reject = false
  constructor(readonly key: Keypair) {}
  async isAvailable() {
    return true
  }
  async getAddress() {
    return { address: this.key.publicKey() }
  }
  async getNetwork() {
    return { network: 'TESTNET', networkPassphrase: this.passphrase }
  }
  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string }
  ) {
    if (this.reject) throw { code: -4, message: 'User declined' }
    const tx = TransactionBuilder.fromXdr(xdr, opts!.networkPassphrase!)
    tx.sign(this.key)
    return { signedTxXdr: tx.toXDR(), signerAddress: this.key.publicKey() }
  }
  async signAuthEntry(): Promise<never> {
    throw { code: -3, message: 'not used' }
  }
  async signMessage(): Promise<never> {
    throw { code: -3, message: 'not used' }
  }
}

it('connects, checks the network and signs through the real 2.x kit', async () => {
  const key = Keypair.random()
  const walletModule = new LocalWallet(key)
  const loadKit = async (): Promise<KitBundle> => ({
    kit: StellarWalletsKit as unknown as KitBundle['kit'],
    modules: [walletModule],
    events: {
      stateUpdated: KitEventType.STATE_UPDATED,
      disconnect: KitEventType.DISCONNECT,
    },
  })
  const wallet = createWalletAdapter({
    loadKit,
    networkPassphrase: Networks.TESTNET,
    storage: null,
  })

  const connection = await wallet.connect({ walletId: 'local-test' })
  expect(connection).toMatchObject({
    address: key.publicKey(),
    walletId: 'local-test',
    walletName: 'Local test wallet',
    networkPassphrase: Networks.TESTNET,
    networkReported: true,
  })

  const tx = new TransactionBuilder(new Account(key.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.manageData({ name: 'local-compatibility', value: 'test' })
    )
    .setTimeout(30)
    .build()
  const signed = await wallet.signTransaction(tx.toXDR())
  expect(signed.signerAddress).toBe(key.publicKey())
  const parsed = TransactionBuilder.fromXdr(
    signed.signedTxXdr,
    Networks.TESTNET
  )
  expect(key.verify(parsed.hash(), parsed.signatures[0]!.signature)).toBe(true)

  walletModule.reject = true
  await expect(wallet.signTransaction(tx.toXDR())).rejects.toSatisfy(
    (error: unknown) => isWalletError(error, 'rejected')
  )

  walletModule.reject = false
  walletModule.passphrase = Networks.PUBLIC
  await expect(wallet.signTransaction(tx.toXDR())).rejects.toSatisfy(
    (error: unknown) => isWalletError(error, 'wrong-network')
  )

  await wallet.disconnect()
  expect(wallet.getConnection()).toBeNull()
})
