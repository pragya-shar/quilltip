/**
 * The fixture session shared by the tab UI pages (`/` and `/dialog`): the
 * state id and session from the query, the stand-in services, and the
 * browser key store put into the scenario's state with the real tab library
 * before anything renders.
 */
import {
  TAB_DB_NAME,
  closeTabDb,
  createSessionKeyStore,
} from '../../../lib/stellar/v2/tab'
import { noteSeenKeyIds } from '../../../lib/tab-ui/device-memory'
import { FIXTURE_READER, FIXTURE_TAB } from './constants'
import { SCENARIOS, type DeviceSetup } from './scenarios'
import { createFixtureServices } from './services'

export const params = new URLSearchParams(location.search)
export const stateId = params.get('state') ?? 'home-no-tab'
let session = params.get('session')
const fresh = !session
if (!session) {
  // A reload keeps the session (and its backend state).
  session = `${stateId}-${crypto.randomUUID().slice(0, 8)}`
  params.set('session', session)
  history.replaceState(null, '', `?${params}`)
}
export const scenario = SCENARIOS.get(stateId)
const scope = { tabContractId: FIXTURE_TAB, readerAddress: FIXTURE_READER }

/** A fresh session starts with an empty key store and no device notes. */
async function clearDevice() {
  closeTabDb()
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TAB_DB_NAME)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
  for (const key of Object.keys(localStorage))
    if (key.startsWith('quilltip-tab')) localStorage.removeItem(key)
  sessionStorage.removeItem('quilltip-tab-pending-operation')
}

export async function seedDevice(kind: DeviceSetup) {
  if (fresh && kind !== 'storage-blocked') await clearDevice()
  if (kind === 'storage-blocked') {
    Object.defineProperty(window, 'indexedDB', { value: undefined })
    return
  }
  if (kind === 'none') return
  const post = (body: unknown) =>
    fetch(
      `/api/seed-device?session=${encodeURIComponent(session!)}&state=${encodeURIComponent(stateId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    ).then(
      (r) => r.json() as Promise<{ keyId: number | null; again?: boolean }>
    )
  const store = createSessionKeyStore()
  if ((await store.list(scope)).length > 0) return
  if (kind === 'gone' || kind === 'other') {
    const random = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
    const { keyId } = await post({ kind, publicKey: random })
    if (kind === 'gone' && keyId !== null)
      noteSeenKeyIds(FIXTURE_TAB, FIXTURE_READER, [keyId])
    return
  }
  const key = await store.generate(scope)
  if (kind === 'pending') return
  const { keyId } = await post({ kind, publicKey: key.info.publicKey })
  if (keyId === null) return
  await store.bindKeyIds(scope, [{ keyId, publicKey: key.info.publicKey }])
  noteSeenKeyIds(FIXTURE_TAB, FIXTURE_READER, [keyId])
  if (kind === 'stopped')
    await store.markUnusable(scope, key.info.publicKey, 'ledger_mismatch')
}

export const services = createFixtureServices({ session, state: stateId })
;(window as unknown as { tabFixture: unknown }).tabFixture = {
  snapshot: services.snapshot,
  control: (patch: Record<string, unknown>) =>
    fetch(`/api/control?session=${encodeURIComponent(session!)}`, {
      method: 'POST',
      body: JSON.stringify({ patch }),
    }),
}
