/**
 * Tab UI fixture page: `/?state=<id>[&session=<id>][&theme=dark]`. It renders
 * the real tab screens with stand-in services, on the dashboard surface;
 * `theme=dark` sets the site's dark appearance around it. Before rendering it puts this
 * browser's key store into the scenario's state with the real tab library.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { TabServicesContext } from '../../../hooks/tab/TabServicesContext'
import { CollectPanel } from '../../../components/tab/CollectPanel'
import { TabHome } from '../../../components/tab/TabHome'
import { TabTipAction } from '../../../components/tab/TabTipAction'
import '../../../components/account/account.css'
import '../../../components/tab/tab.css'
import { scenario, seedDevice, services, stateId } from './session'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark')
  document.documentElement.classList.add('dark')

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
