'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/convex/_generated/api'
import { HANDLE_MAX_LENGTH, handleFormatError } from '@/lib/profile/handleRules'

const CHECK_DELAY_MS = 300

/**
 * "Change handle" button and dialog. On a writer page the page moves to the
 * new handle; elsewhere pass `onChanged` to stay put.
 */
export function ProfileHandleEditor({
  username,
  onChanged,
}: {
  username: string
  onChanged?: (username: string) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const changeHandle = useMutation(api.handles.changeHandle)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(username)
  const [checked, setChecked] = useState(username)
  const [saving, setSaving] = useState(false)

  const handle = value.trim()
  useEffect(() => {
    const timer = setTimeout(() => setChecked(handle), CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [handle])

  const formatError = handle === username ? null : handleFormatError(handle)
  const status = useQuery(
    api.handles.checkHandle,
    open && !formatError && handle !== username && checked === handle
      ? { handle }
      : 'skip'
  )

  const message = formatError
    ? formatError
    : handle === username
      ? 'This is your current handle.'
      : status === undefined
        ? 'Checking…'
        : status.status === 'available'
          ? `quilltip.me/${handle} is available.`
          : status.status === 'taken'
            ? 'That handle is taken.'
            : status.status === 'invalid'
              ? status.message
              : 'This is your current handle.'
  const canSave =
    !saving && handle !== username && status?.status === 'available'

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      const result = await changeHandle({ handle })
      toast.success(`Your handle is now @${result.username}`)
      setOpen(false)
      if (onChanged) {
        onChanged(result.username)
        return
      }
      // Same page under the new handle; the old URL now redirects here.
      const segments = (pathname ?? '').split('/')
      segments[1] = encodeURIComponent(result.username)
      const query = searchParams?.toString()
      router.replace(`${segments.join('/')}${query ? `?${query}` : ''}`)
    } catch (error) {
      toast.error(
        error instanceof ConvexError && typeof error.data === 'string'
          ? error.data
          : 'Could not change your handle. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="profile-handle-edit"
        onClick={() => {
          setValue(username)
          setOpen(true)
        }}
      >
        Change handle
      </button>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change your handle</DialogTitle>
            <DialogDescription>
              Your handle is part of your profile and article links. Links with
              your current handle keep working and lead to the new one.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
            className="space-y-2"
          >
            <Label htmlFor="profile-handle-input">Handle</Label>
            <Input
              id="profile-handle-input"
              value={value}
              maxLength={HANDLE_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-describedby="profile-handle-status"
              aria-invalid={Boolean(formatError) || status?.status === 'taken'}
              onChange={(event) => setValue(event.target.value)}
            />
            <p
              id="profile-handle-status"
              role="status"
              className="text-sm text-ui-muted-foreground"
            >
              {message}
            </p>
            <p className="text-xs text-ui-muted-foreground">
              Letters, numbers and underscores, 3 to {HANDLE_MAX_LENGTH}{' '}
              characters.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save handle
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
