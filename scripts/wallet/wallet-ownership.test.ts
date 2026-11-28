import { describe, expect, test, vi } from 'vitest'
import {
  Keypair,
  Networks,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk'
import {
  WALLET_CHALLENGE_TTL_MS,
  challengeMessage,
  challengeTransaction,
  checkWalletProof,
  type WalletChallengeFields,
} from '../../convex/lib/walletChallenge'
import {
  WalletOwnershipError,
  ownershipErrorMessage,
  proveWalletOwnership,
  type OwnershipDeps,
  type VerifyResult,
  type WalletChallenge,
} from '../../lib/stellar/v2/wallet-ownership'
import { WalletError } from '../../lib/stellar/v2/wallet-errors'

const ORIGIN = 'http://localhost:3000'

/** A server stand-in that runs the real proof check on stored fields. */
function server(address: string) {
  const challenges = new Map<string, WalletChallengeFields>()
  let n = 0
  return {
    issued: () => n,
    createChallenge: vi.fn(
      async (args: { address: string; origin: string }) => {
        const fields: WalletChallengeFields = {
          address: args.address,
          userId: 'user1',
          networkPassphrase: Networks.TESTNET,
          origin: args.origin,
          nonce: String(++n).padStart(32, '0'),
          issuedAt: 1_800_000_000_000,
          expiresAt: 1_800_000_000_000 + WALLET_CHALLENGE_TTL_MS,
        }
        const id = `c${n}`
        challenges.set(id, fields)
        return {
          challengeId: id,
          message: challengeMessage(fields),
          transactionXdr: challengeTransaction(fields).toXDR(),
          networkPassphrase: fields.networkPassphrase,
          expiresAt: fields.expiresAt,
        } satisfies WalletChallenge
      }
    ),
    verifyChallenge: vi.fn(
      async (args: Parameters<OwnershipDeps['verifyChallenge']>[0]) => {
        const fields = challenges.get(args.challengeId)!
        challenges.delete(args.challengeId)
        const check = checkWalletProof(fields, args.proof)
        const result: VerifyResult = check.ok
          ? { ok: true, address, verifiedAt: 1 }
          : { ok: false, reason: check.reason }
        return result
      }
    ),
  }
}

function walletFor(
  key: Keypair,
  opts: { messages?: 'sep53' | 'unsupported' | 'raw' } = {}
) {
  return {
    getConnection: () => ({ address: key.publicKey() }),
    signMessage: vi.fn(async (message: string) => {
      if (opts.messages === 'unsupported') {
        throw new WalletError('unsupported', 'no message signing')
      }
      const signature =
        opts.messages === 'raw'
          ? key.sign(new TextEncoder().encode(message))
          : key.signMessage(message)
      return { signedMessage: btoa(String.fromCharCode(...signature)) }
    }),
    signTransaction: vi.fn(async (xdr: string) => {
      const tx = TransactionBuilder.fromXDR(
        xdr,
        Networks.TESTNET
      ) as Transaction
      tx.sign(key)
      return { signedTxXdr: tx.toXDR() }
    }),
  }
}

describe('proveWalletOwnership', () => {
  test('uses a SEP-53 message signature when the wallet supports it', async () => {
    const key = Keypair.random()
    const srv = server(key.publicKey())
    const wallet = walletFor(key)
    const steps: string[] = []
    const result = await proveWalletOwnership({
      wallet,
      origin: ORIGIN,
      createChallenge: srv.createChallenge,
      verifyChallenge: srv.verifyChallenge,
      onStep: (step, method) => steps.push(`${step}:${method}`),
    })
    expect(result).toEqual({
      address: key.publicKey(),
      verifiedAt: 1,
      method: 'message',
    })
    expect(wallet.signTransaction).not.toHaveBeenCalled()
    expect(steps).toEqual([
      'challenge:message',
      'sign:message',
      'verify:message',
    ])
  })

  test('falls back to the never-submitted transaction when messages are unsupported', async () => {
    const key = Keypair.random()
    const srv = server(key.publicKey())
    const wallet = walletFor(key, { messages: 'unsupported' })
    const result = await proveWalletOwnership({
      wallet,
      origin: ORIGIN,
      createChallenge: srv.createChallenge,
      verifyChallenge: srv.verifyChallenge,
    })
    expect(result.method).toBe('transaction')
    expect(srv.issued()).toBe(2)
    const signed = TransactionBuilder.fromXDR(
      (await wallet.signTransaction.mock.results[0]!.value).signedTxXdr,
      Networks.TESTNET
    ) as Transaction
    expect(signed.sequence).toBe('0')
  })

  test('falls back to the transaction when a message signature is not SEP-53', async () => {
    const key = Keypair.random()
    const srv = server(key.publicKey())
    const wallet = walletFor(key, { messages: 'raw' })
    const result = await proveWalletOwnership({
      wallet,
      origin: ORIGIN,
      createChallenge: srv.createChallenge,
      verifyChallenge: srv.verifyChallenge,
    })
    expect(result.method).toBe('transaction')
    expect(srv.verifyChallenge).toHaveBeenCalledTimes(2)
  })

  test('reports a refused proof with the server reason', async () => {
    const key = Keypair.random()
    const srv = server(key.publicKey())
    srv.verifyChallenge.mockResolvedValue({
      ok: false,
      reason: 'ADDRESS_IN_USE',
    })
    const error = await proveWalletOwnership({
      wallet: walletFor(key),
      origin: ORIGIN,
      createChallenge: srv.createChallenge,
      verifyChallenge: srv.verifyChallenge,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WalletOwnershipError)
    expect((error as WalletOwnershipError).reason).toBe('ADDRESS_IN_USE')
    expect(ownershipErrorMessage('ADDRESS_IN_USE').title).toBe(
      'This address is verified on another account'
    )
  })

  test('passes wallet failures through, and needs a connection', async () => {
    const key = Keypair.random()
    const srv = server(key.publicKey())
    const wallet = walletFor(key)
    wallet.signMessage.mockRejectedValueOnce(
      new WalletError('rejected', 'User declined')
    )
    await expect(
      proveWalletOwnership({
        wallet,
        origin: ORIGIN,
        createChallenge: srv.createChallenge,
        verifyChallenge: srv.verifyChallenge,
      })
    ).rejects.toMatchObject({ kind: 'rejected' })
    expect(wallet.signTransaction).not.toHaveBeenCalled()
    await expect(
      proveWalletOwnership({
        wallet: { ...wallet, getConnection: () => null },
        origin: ORIGIN,
        createChallenge: srv.createChallenge,
        verifyChallenge: srv.verifyChallenge,
      })
    ).rejects.toMatchObject({ kind: 'locked' })
  })
})
