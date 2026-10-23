'use client'

import { forwardRef } from 'react'

interface ToolbarButtonProps {
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  children: React.ReactNode
  title?: string
  className?: string
  tabIndex?: number
  onFocus?: React.FocusEventHandler<HTMLButtonElement>
  toolbarKey?: string
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    {
      onClick,
      isActive = false,
      disabled = false,
      children,
      title,
      className = '',
      tabIndex,
      onFocus,
      toolbarKey,
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-pressed={isActive}
        tabIndex={tabIndex}
        onFocus={onFocus}
        data-toolbar-item="true"
        data-toolbar-key={toolbarKey}
        className={`
        p-2 rounded hover:bg-muted transition-colors shrink-0
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
        ${isActive ? 'bg-muted text-primary' : 'text-foreground'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      >
        {children}
      </button>
    )
  }
)
