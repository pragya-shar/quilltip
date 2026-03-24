'use client'

import { useState, useCallback, useEffect } from 'react'
import { Search, X } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  debounceMs?: number
}

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search articles...',
  className = '',
  debounceMs = 300,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value)

  // Debounced onChange callback
  const debouncedOnChange = useCallback(
    (searchValue: string) => {
      const timer = setTimeout(() => {
        onChange(searchValue)
      }, debounceMs)

      return () => clearTimeout(timer)
    },
    [onChange, debounceMs]
  )

  // Update local value when prop value changes (for external updates)
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)

    // Clear previous timeout and set new one
    const cleanup = debouncedOnChange(newValue)
    return cleanup
  }

  // Clear search
  const clearSearch = () => {
    setLocalValue('')
    onChange('')
  }

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-quill-500" />
        <input
          type="text"
          value={localValue}
          onChange={handleInputChange}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent text-foreground placeholder:text-muted-foreground"
        />
        {localValue && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-quill-500 hover:text-quill-700 transition-colors"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
