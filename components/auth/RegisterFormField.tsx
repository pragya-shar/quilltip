import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const authInputClassName =
  'rounded-lg bg-background text-foreground focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:border-transparent'

export type RegisterFieldControlProps = {
  'aria-invalid': boolean
  'aria-describedby'?: string
  inputClassName: string
  errorId: string
}

type RegisterFormFieldProps = {
  id: string
  label: ReactNode
  error?: string
  extraDescribedBy?: string
  children: (control: RegisterFieldControlProps) => ReactNode
}

export function RegisterFormField({
  id,
  label,
  error,
  extraDescribedBy,
  children,
}: RegisterFormFieldProps) {
  const errorId = `${id}-error`
  const invalid = !!error
  const describedBy = [extraDescribedBy, invalid ? errorId : undefined]
    .filter(Boolean)
    .join(' ')
  const control: RegisterFieldControlProps = {
    'aria-invalid': invalid,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    inputClassName: cn(
      authInputClassName,
      invalid &&
        'border-destructive focus-visible:ring-destructive focus-visible:border-destructive'
    ),
    errorId,
  }

  return (
    <div>
      <label
        htmlFor={id}
        className={cn(
          'block text-sm font-medium text-foreground mb-2',
          invalid && 'text-destructive'
        )}
      >
        {label}
      </label>
      {children(control)}
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
