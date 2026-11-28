/**
 * This browser's balance signer: the session key in IndexedDB, the local
 * ledger, and the send of one tip. Loaded with `import()` by the payments
 * provider once a signed-in reader has a balance, so no route's first load
 * carries the Stellar SDK, the key store or IndexedDB code (scripts/perf).
 * No wallet is loaded or asked: a balance tip needs only the verified
 * address, this device's key and the server.
 */
import {
  commitAcceptedTip,
  createLocalLedger,
  createSessionKeyStore,
  signTabTip,
  tabConfig,
  type SessionKeyScope,
} from '@/lib/stellar/v2/tab'
import { noteSeenKeyIds, seenKeyIds } from '@/lib/tab-ui/device-memory'
import { deviceKeyView, type DeviceKeyView } from '@/lib/tab-ui/key-plan'
import type { OutboxEntry } from '../outbox'
import { sendBalanceTip, type BalanceTipDeps } from '../tip'

/** Ledgers close about every 5 seconds. */
const LEDGER_MS = 5_000

export type ServerDevice = {
  keyId: number
  publicKey: string | null
  validUntilLedger: number
  revoked: boolean
}

export type DeviceReading = {
  state: 'ready' | 'checking' | 'needs-setup' | 'unavailable'
  keyId: number | null
  view: DeviceKeyView['kind']
}

/**
 * The balance's device state for a key view. `unchecked` (an approval is
 * held but no ledger was read to check its end) waits as `checking`: it
 * never asks for a new approval and never signs.
 */
export function deviceReading(view: DeviceKeyView): DeviceReading {
  if (view.kind === 'ready')
    return { state: 'ready', keyId: view.keyId, view: view.kind }
  if (view.kind === 'storage-unavailable')
    return { state: 'unavailable', keyId: null, view: view.kind }
  if (view.kind === 'unchecked')
    return { state: 'checking', keyId: null, view: view.kind }
  return { state: 'needs-setup', keyId: null, view: view.kind }
}

export type Signer = {
  scope: SessionKeyScope
  /** This device's key against the server's list, at the indexer's ledger. */
  deviceState(
    devices: ServerDevice[],
    ledger: { sequence: number; closedAt: number } | null,
    now: number
  ): Promise<DeviceReading>
  send(
    entry: OutboxEntry,
    keyId: number,
    deps: Omit<BalanceTipDeps, 'sign' | 'commit'>
  ): ReturnType<typeof sendBalanceTip>
}

export function createSigner(readerAddress: string): Signer {
  const config = tabConfig()
  const scope: SessionKeyScope = {
    tabContractId: config.tabContractId,
    readerAddress,
  }
  const keys = createSessionKeyStore()
  const ledger = createLocalLedger()
  const signing = {
    keys,
    ledger,
    networkPassphrase: config.networkPassphrase,
    tabContractId: config.tabContractId,
    readerAddress,
  }
  return {
    scope,
    async deviceState(devices, clock, now) {
      try {
        const bound = await keys.bindKeyIds(
          scope,
          devices.map((d) => ({ keyId: d.keyId, publicKey: d.publicKey }))
        )
        const held = await keys.list(scope)
        noteSeenKeyIds(
          scope.tabContractId,
          scope.readerAddress,
          [...bound, ...held].flatMap((k) => k.info.keyIds)
        )
        const currentLedger = clock
          ? clock.sequence +
            Math.max(0, Math.floor((now - clock.closedAt) / LEDGER_MS))
          : null
        const view = deviceKeyView({
          serverKeys: devices,
          localKeys: held.map((k) => k.info),
          currentLedger,
          seenKeyIds: seenKeyIds(scope.tabContractId, scope.readerAddress),
        })
        return deviceReading(view)
      } catch {
        return {
          state: 'unavailable',
          keyId: null,
          view: 'storage-unavailable',
        }
      }
    },
    send(entry, keyId, deps) {
      return sendBalanceTip(entry, keyId, {
        ...deps,
        sign: (prepared) => signTabTip(prepared, signing),
        commit: async (accepted) => {
          await commitAcceptedTip(accepted, signing)
        },
      })
    },
  }
}
