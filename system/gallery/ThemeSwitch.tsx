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
  // Null until the page has been read: nothing changes before that.
  const [theme, setTheme] = useState<Theme | null>(null)
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('theme')
    const stored = document.documentElement.dataset.theme
    const start = asked ?? stored
    setTheme(start === 'light' || start === 'dark' ? start : 'system')
  }, [])
  useEffect(() => {
    if (theme === null) return
    const root = document.documentElement
    const before = root.dataset.theme
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    return () => {
      if (before) root.dataset.theme = before
      else delete root.dataset.theme
    }
  }, [theme])
  return (
    <Tabs
      items={ITEMS}
      value={theme ?? 'system'}
      onChange={(id) => setTheme(id as Theme)}
      label="Theme"
      variant="segmented"
    />
  )
}
