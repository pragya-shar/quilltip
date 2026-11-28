import { createRoot } from 'react-dom/client'
import '../../../system/system.css'
import '../../../shell/shell.css'
import '../system/fixture.css'
import { ToastRegion } from '../../../system/components/ToastRegion'
import { AppShell } from '../../../shell/AppShell'
import { SheetHost } from '../../../shell/SheetHost'
import { BalanceSourceContext } from '../../../shell/balance'
import { registerSheet } from '../../../shell/sheetRegistry'
import { SIGN_IN_SHEET } from '../../../shell/signIn'
import { ArticleView } from '../../../components/read/ArticleView'
import { toReadArticle } from '../../../components/read/readModel'
import { TippedLinesSourceContext } from '../../../hooks/read/tippedLines'
import { PaymentsRuntimeContext } from '../../../lib/payments/runtime'
import { DemoSignInSheet } from '../system/DemoSignInSheet'
import { ARTICLE } from './article'
import { fakeRuntime, useFakeBalanceReading } from './payments'
import { useFixtureTippedLines } from './tippedLines'

// The article view inside the real application shell, with no backend: the
// body HTML is rendered by the fixture server with the server renderer and
// handed over in the page; money comes from the fake runtime. What
// e2e/read.spec.ts drives. `?pay=` picks the payments scenario,
// `?signin=sheet` registers a stand-in sign-in sheet, `?tippable=no` is an
// article not registered for tips.
declare global {
  interface Window {
    __READ_BODY__: string
  }
}

if (new URLSearchParams(location.search).get('signin') === 'sheet')
  registerSheet(SIGN_IN_SHEET, DemoSignInSheet)

const readNext = [
  {
    id: 'next-1',
    title: 'The last keeper of the Ras al-Hadd light',
    href: '/noor/the-last-keeper',
    opening:
      'Salim climbs the stairs every evening, though the lamp is automatic now.',
  },
]

createRoot(document.getElementById('root')!).render(
  <BalanceSourceContext.Provider value={useFakeBalanceReading}>
    <PaymentsRuntimeContext.Provider value={fakeRuntime}>
      <TippedLinesSourceContext.Provider value={useFixtureTippedLines}>
        <AppShell
          beside={
            <>
              <SheetHost />
              <ToastRegion />
            </>
          }
        >
          <ArticleView
            article={{
              ...toReadArticle(ARTICLE, Date.UTC(2026, 10, 28)),
              // As the server render reads it: `?tippable=no` is an article
              // not registered for tips.
              tippable:
                new URLSearchParams(location.search).get('tippable') === 'no'
                  ? false
                  : true,
            }}
            bodyHtml={window.__READ_BODY__}
            readNext={readNext}
          />
        </AppShell>
      </TippedLinesSourceContext.Provider>
    </PaymentsRuntimeContext.Provider>
  </BalanceSourceContext.Provider>
)
