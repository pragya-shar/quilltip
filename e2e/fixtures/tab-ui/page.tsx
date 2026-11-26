/**
 * Tab UI fixture page: `/?state=<id>[&session=<id>]`. It renders the real
 * tab screens with stand-in services. Before rendering it puts this
 * browser's key store into the scenario's state with the real tab library.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { TabServicesContext } from '../../../hooks/tab/TabServicesContext'
import {
  TAB_DB_NAME,
  closeTabDb,
  createSessionKeyStore,
} from '../../../lib/stellar/v2/tab'
import { noteSeenKeyIds } from '../../../lib/tab-ui/device-memory'
import { CollectPanel } from '../../../components/tab/CollectPanel'
import { TabHome } from '../../../components/tab/TabHome'
import { TabTipAction } from '../../../components/tab/TabTipAction'
import '../../../components/account/account.css'
import '../../../components/tab/tab.css'
import { FIXTURE_READER, FIXTURE_TAB } from './constants'
import { SCENARIOS, type DeviceSetup } from './scenarios'
import { createFixtureServices } from './services'

const params = new URLSearchParams(location.search)
const stateId = params.get('state') ?? 'home-no-tab'
let session = params.get('session')
const fresh = !session
if (!session) {
  // A reload keeps the session (and its backend state).
  session = `${stateId}-${crypto.randomUUID().slice(0, 8)}`
  params.set('session', session)
  history.replaceState(null, '', `?${params}`)
}
const scenario = SCENARIOS.get(stateId)
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

async function seedDevice(kind: DeviceSetup) {
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

const services = createFixtureServices({ session, state: stateId })
;(window as unknown as { tabFixture: unknown }).tabFixture = {
  snapshot: services.snapshot,
  control: (patch: Record<string, unknown>) =>
    fetch(`/api/control?session=${encodeURIComponent(session!)}`, {
      method: 'POST',
      body: JSON.stringify({ patch }),
    }),
}

function Fixture() {
  const view = scenario?.view ?? 'home'
  return (
    <TabServicesContext.Provider value={services}>
      <div className="account-surface" style={{ minHeight: 'auto' }}>
        <main
          className="account-folio"
          style={{ minHeight: 'auto', margin: 0 }}
        >
          <p className="tab-subtle" data-testid="fixture-state">
            Fixture: {scenario?.title ?? stateId}
          </p>
          {view === 'home' ? (
            <div className="tab-ui">
              <div className="account-heading">
                <h1>Tab</h1>
              </div>
              <TabHome />
            </div>
          ) : view === 'tip' ? (
            <div className="tab-ui" style={{ maxWidth: 440, paddingTop: 24 }}>
              <TabTipAction
                articleId="article-1"
                recipientCount={scenario?.splits ? 2 : 1}
                writerName="Ada Lovelace"
                manageHref="#tab"
                onTipFromWallet={() =>
                  document.body.setAttribute('data-wallet-tip', 'opened')
                }
              />
            </div>
          ) : (
            <div className="tab-ui" style={{ paddingTop: 24 }}>
              <CollectPanel />
            </div>
          )}
        </main>
      </div>
    </TabServicesContext.Provider>
  )
}

void seedDevice(scenario?.device ?? 'none').then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Fixture />
    </StrictMode>
  )
})
