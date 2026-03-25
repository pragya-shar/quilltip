'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <span className="inline-flex h-9 w-9 shrink-0" aria-hidden />
  }

  const cycle = () => {
    if (theme === 'light') setTheme('dark')
    else if (theme === 'dark') setTheme('system')
    else setTheme('light')
  }

  const Icon =
    theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  const label =
    theme === 'system'
      ? 'Theme: system (click for light)'
      : theme === 'light'
        ? 'Theme: light (click for dark)'
        : 'Theme: dark (click for system)'

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="shrink-0 text-muted-foreground hover:text-foreground"
      onClick={cycle}
      aria-label={label}
      title={label}
    >
      <Icon className="size-4" />
    </Button>
  )
}
