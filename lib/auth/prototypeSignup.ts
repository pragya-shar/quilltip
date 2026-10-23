import { z } from 'zod'
import { registerSchema } from '@/lib/validations/auth'

const existingFields = registerSchema.shape
export const prototypeSignupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Add the name you’d like people to see.')
    .max(80, 'Use at most 80 characters.'),
  email: existingFields.email,
  password: existingFields.password,
})
export type PrototypeSignupData = z.infer<typeof prototypeSignupSchema>

// The current profile schema requires a URL-safe handle, independently of name.
export function createAccountHandle(): string {
  return `q${crypto.randomUUID().replaceAll('-', '').slice(0, 19)}`
}
