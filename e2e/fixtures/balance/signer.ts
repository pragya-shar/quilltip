/**
 * Stand-in for `lib/payments/live/signer.ts`: the real `sendBalanceTip`
 * (prepare, sign, submit, commit) with a signature that names the reader
 * instead of an ed25519 key, so tests can check who signed. Reports a ready
 * device unless the scenario says otherwise.
 */
import { sendBalanceTip } from '../../../lib/payments/tip'
import type { Signer } from '../../../lib/payments/live/signer'
import { fixtureTab } from './backend'

export type {
  DeviceReading,
  ServerDevice,
  Signer,
} from '../../../lib/payments/live/signer'

export function createSigner(readerAddress: string): Signer {
  const device = new URLSearchParams(location.search).get('device') ?? 'ready'
  return {
    scope: { tabContractId: fixtureTab, readerAddress },
    async deviceState() {
      return device === 'ready'
        ? { state: 'ready', keyId: 0, view: 'ready' }
        : { state: 'needs-setup', keyId: null, view: 'none' }
    },
    async heldKeyIds() {
      return device === 'ready' ? [0] : []
    },
    send(entry, keyId, deps) {
      return sendBalanceTip(entry, keyId, {
        ...deps,
        sign: async (prepared) => ({
          kind: 'signed',
          submit: {
            prepareId: prepared.prepareId,
            receipt: prepared.receipt,
            signature: `sig:${readerAddress}:${prepared.prepareId}`,
          },
          voucher: {
            keyId,
            writer: prepared.writer,
            cumulative: prepared.receipt.cumulativeAfter,
            receiptsRoot: 'rr',
            leafHashes: [],
            publicKey: `key-${readerAddress}`,
          },
          replay: false,
        }),
        commit: async () => {},
      })
    },
  }
}
