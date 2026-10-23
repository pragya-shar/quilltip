'use client'

export function ToolbarDivider({ className = '' }: { className?: string }) {
  return (
    <div
      className={`w-px h-5 bg-border mx-0.5 shrink-0 ${className}`}
      aria-hidden
    />
  )
}
