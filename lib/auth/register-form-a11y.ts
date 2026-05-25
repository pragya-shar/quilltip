import type { FieldErrors } from 'react-hook-form'
import type { RegisterFormData } from '@/lib/validations/auth'

export const REGISTER_FIELD_ORDER = [
  'email',
  'username',
  'name',
  'password',
  'confirmPassword',
] as const satisfies readonly (keyof RegisterFormData)[]

export type RegisterFieldName = (typeof REGISTER_FIELD_ORDER)[number]

export function getFirstRegisterFieldError(
  errors: FieldErrors<RegisterFormData>
): { field: RegisterFieldName; message: string } | null {
  for (const field of REGISTER_FIELD_ORDER) {
    const err = errors[field]
    if (err?.message) {
      return { field, message: String(err.message) }
    }
  }
  return null
}
