import { useEffect, useState } from 'react'
import { AppShell } from '../../../shell/AppShell'
import {
  BalanceSourceContext,
  type BalanceReading,
} from '../../../shell/balance'
import { SheetHost } from '../../../shell/SheetHost'
import { ToastRegion } from '../../../system/components/ToastRegion'
import { TodayView } from '../../../components/today/TodayView'
import {
  readPlaces,
  type ReadingPlace,
} from '../../../components/today/readingPlace'
import {
  TodayRowsSourceContext,
  type TodayRowsReading,
} from '../../../components/today/rowsSource'
import { todayData, type FixtureState } from './state'

/**
 * Today in the real application shell, rendered on the server and hydrated
 * in the browser, as Next.js does. Auth and drafts are fakes that answer
 * after `delay`; the reading places are the browser's real storage.
 */
export function FixtureApp({ state }: { state: FixtureState }) {
  const useFakeRows = (): TodayRowsReading => {
    const [answered, setAnswered] = useState(false)
    const [places, setPlaces] = useState<ReadingPlace[] | undefined>()
    useEffect(() => {
      setPlaces(readPlaces())
      if (state.auth === 'loading') return
      const timer = setTimeout(() => setAnswered(true), state.delay)
      return () => clearTimeout(timer)
    }, [])
    if (!answered) return { auth: 'loading', places, draft: undefined }
    return state.auth === 'signed-in'
      ? { auth: 'signed-in', places, draft: state.draft }
      : { auth: 'signed-out', places, draft: null }
  }
  const balance: BalanceReading =
    state.auth === 'signed-in'
      ? {
          auth: 'signed-in',
          available: { cents: 1840, display: '$18.40' },
          status: 'ready',
        }
      : { auth: 'signed-out', available: null, status: 'unavailable' }
  return (
    <BalanceSourceContext.Provider value={() => balance}>
      <TodayRowsSourceContext.Provider value={useFakeRows}>
        <AppShell
          beside={
            <>
              <SheetHost />
              <ToastRegion />
            </>
          }
        >
          <TodayView data={todayData(state)} />
        </AppShell>
      </TodayRowsSourceContext.Provider>
    </BalanceSourceContext.Provider>
  )
}
