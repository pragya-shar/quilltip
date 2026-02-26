import { z } from 'zod'

/**
 * Authentication Validation Schemas
 *
 * Centralized validation schemas for authentication forms using Zod.
 * These schemas ensure consistent validation across the application.
 */

// Password validation regex patterns
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/

// Username validation regex pattern
const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/

/**
 * Login form validation schema
 */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

/**
 * Registration form validation schema
 */
export const registerSchema = z
  .object({
    email: z
      .string()
      .min(1, 'Email is required')
      .email('Please enter a valid email address'),
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(20, 'Username must be at most 20 characters')
      .regex(
        USERNAME_REGEX,
        'Username can only contain letters, numbers, underscores, and hyphens'
      ),
    password: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
      )
      .regex(
        PASSWORD_REGEX,
        'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      ),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    name: z
      .string()
      .min(1, 'Name is required')
      .max(50, 'Name must be at most 50 characters')
      .optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

/**
 * Profile update validation schema
 */
export const profileUpdateSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(50, 'Name must be at most 50 characters')
    .optional(),
  bio: z.string().max(500, 'Bio must be at most 500 characters').optional(),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be at most 20 characters')
    .regex(
      USERNAME_REGEX,
      'Username can only contain letters, numbers, underscores, and hyphens'
    )
    .optional(),
})

/**
 * Password change validation schema
 */
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
      )
      .regex(
        PASSWORD_REGEX,
        'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      ),
    confirmNewPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords don't match",
    path: ['confirmNewPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  })

// Type exports for form data
export type LoginFormData = z.infer<typeof loginSchema>
export type RegisterFormData = z.infer<typeof registerSchema>
export type ProfileUpdateFormData = z.infer<typeof profileUpdateSchema>
export type PasswordChangeFormData = z.infer<typeof passwordChangeSchema>
