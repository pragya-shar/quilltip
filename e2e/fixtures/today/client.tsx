import { hydrateRoot } from 'react-dom/client'
import '../../../system/system.css'
import '../../../shell/shell.css'
import '../../../components/today/today.css'
import { FixtureApp } from './App'
import { stateFrom } from './state'

// The browser half: hydrate the server HTML with the same state.
hydrateRoot(
  document.getElementById('root')!,
  <FixtureApp state={stateFrom(location.search)} />
)
