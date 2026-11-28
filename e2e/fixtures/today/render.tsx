import { renderToString } from 'react-dom/server'
import { FixtureApp } from './App'
import { stateFrom } from './state'

/** The server half: Today's HTML for a query string. */
export function render(search: string): { html: string; state: string } {
  const state = stateFrom(search)
  return { html: renderToString(<FixtureApp state={state} />), state: search }
}
