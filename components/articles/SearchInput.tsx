'use client'

import { useState, useRef, useEffect, useId } from 'react'
import { Search, X } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  debounceMs?: number
  id?: string
}

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search articles...',
  className = '',
  debounceMs = 300,
  id: idProp,
}: SearchInputProps) {
  const generatedId = useId()
  const inputId = idProp ?? generatedId
  const [localValue, setLocalValue] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Update local value when prop value changes (for external updates)
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  // Cancel pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)

    if (timerRef.current !== null) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onChangeRef.current(newValue)
    }, debounceMs)
  }

  const clearSearch = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setLocalValue('')
    onChange('')
  }

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-quill-500"
          aria-hidden
        />
        <input
          id={inputId}
          type="text"
          value={localValue}
          onChange={handleInputChange}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2 border border-input rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:border-transparent text-foreground placeholder:text-muted-foreground"
        />
        {localValue && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm text-quill-500 transition-colors hover:text-quill-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
