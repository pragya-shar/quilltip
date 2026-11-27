'use client'

import { useEffect, useState } from 'react'
import { Tabs } from '../components/Tabs'

type Theme = 'system' | 'light' | 'dark'

const ITEMS = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

/**
 * The gallery's theme choice, for this page view only. It sets
 * `data-theme` on <html>, the same switch tokens.css reads. `?theme=dark`
 * in the address picks one on load.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>('system')
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('theme')
    if (asked === 'light' || asked === 'dark') setTheme(asked)
  }, [])
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    return () => {
      delete root.dataset.theme
    }
  }, [theme])
  return (
    <Tabs
      items={ITEMS}
      value={theme}
      onChange={(id) => setTheme(id as Theme)}
      label="Theme"
      variant="segmented"
    />
  )
}
