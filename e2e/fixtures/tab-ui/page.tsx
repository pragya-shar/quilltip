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
import { CreatorStatsPanel } from '../../../components/dashboard/CreatorStatsPanel'
import { CompactEarningsFigures } from '../../../components/dashboard/CompactEarningsFigures'
import { TabHome } from '../../../components/tab/TabHome'
import { TabTipAction } from '../../../components/tab/TabTipAction'
import { WalletActivityView } from '../../../components/dashboard/WalletActivityView'
import { useTabServices } from '../../../hooks/tab/TabServicesContext'
import type { TipActivityItem } from '../../../lib/account/tipActivity'
import type { MyTabTips } from '../../../lib/tab-ui/types'
import '../../../components/account/account.css'
import '../../../components/tab/tab.css'
import { scenario, seedDevice, services, stateId } from './session'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark')
  document.documentElement.classList.add('dark')

/**
 * The wallet page's tip history and receipt (#643), from the fixture's tab
 * tips as the reader's sent tips. `WalletActivity` reads the same tab state
 * the same way: both render `WalletActivityView`, which waits for the tab.
 */
function walletItems(tips: MyTabTips['tips']): TipActivityItem[] {
  return tips.map((tip) => ({
    key: `tips:${tip.receiptId}:sent`,
    kind: 'article',
    id: tip.receiptId as TipActivityItem['id'] & string,
    direction: 'sent',
    status: tip.status,
    createdAt: tip.acceptedAt,
    amountCents: Math.round((Number(tip.amount) / 10_000_000) * 12),
    counterpart: tip.authorName ?? 'Ada Lovelace',
    articleTitle: tip.articleTitle ?? 'Untitled',
    articleHref: null,
    stellarNetwork: 'TESTNET',
    stellarAmountXlm: (Number(tip.amount) / 10_000_000).toString(),
    contractVersion: 'v2',
  })) as TipActivityItem[]
}

function WalletFixture() {
  const services = useTabServices()
  const tab = services.useMyTab()
  const tips = services.useMyTabTips()
  return (
    <WalletActivityView
      activity={
        tips === undefined
          ? { status: 'loading' }
          : { status: 'ready', items: walletItems(tips?.tips ?? []) }
      }
      tab={tab}
    />
  )
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
          ) : view === 'wallet' ? (
            <div className="tab-ui" style={{ paddingTop: 24 }}>
              <WalletFixture />
            </div>
          ) : view === 'stats' && scenario?.stats ? (
            <div className="tab-ui" style={{ paddingTop: 24 }}>
              <CreatorStatsPanel
                articleCount={4}
                tipsReceivedCount={scenario.stats.tipCount}
                earnedStroops={scenario.stats.earnedStroops}
                estimatedUsd={scenario.stats.estimatedUsd}
                isTestnet
                nftsOwned={0}
                complete={scenario.stats.complete ?? true}
                updating={scenario.stats.updating ?? false}
                source={scenario.stats.source ?? 'lifetime'}
              />
              {/* The dashboard card, from the same summary. */}
              <div
                className="compact-earnings"
                data-testid="compact-earnings"
                style={{ marginTop: 32, maxWidth: 320 }}
              >
                <CompactEarningsFigures
                  earnedStroops={scenario.stats.earnedStroops}
                  estimatedUsd={scenario.stats.estimatedUsd}
                  tipCount={scenario.stats.tipCount}
                  isTestnet
                  complete={scenario.stats.complete ?? true}
                  unpricedTipCount={0}
                  updating={scenario.stats.updating ?? false}
                />
              </div>
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
