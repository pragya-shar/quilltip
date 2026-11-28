'use client'

import { useCallback, type FormEvent, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import {
  EARLY_SUBMIT_ATTRIBUTE,
  HELD_FORM_PROPERTY,
  HELD_SUBMIT_ATTRIBUTE,
  SCRIPTS_ACTIVE_ATTRIBUTE,
} from '@/lib/auth/earlySubmit'

type TypedValues = (readonly [HTMLInputElement, string])[]

const isTextField = (input: HTMLInputElement) =>
  !['checkbox', 'radio', 'hidden', 'submit'].includes(input.type)

/**
 * Text typed or filled in before React attached the form is in the fields
 * but not in React's state, and a controlled field loses it on its next
 * render. Read it when React attaches the form (React has then set each
 * field's defaultValue to the value it rendered).
 */
function valuesFromBeforeScripts(form: HTMLFormElement): TypedValues {
  return [...form.querySelectorAll('input')]
    .filter((input) => isTextField(input) && input.value !== input.defaultValue)
    .map((input) => [input, input.value] as const)
}

/**
 * When React renders the form anew instead of attaching to the server HTML,
 * the reader's values are in the old form, which is no longer in the page.
 * Match its fields to the new form's by id.
 */
function valuesFromReplacedForm(
  old: HTMLFormElement,
  form: HTMLFormElement
): TypedValues {
  return [...old.querySelectorAll('input')].flatMap((input) => {
    const field = input.id
      ? form.querySelector<HTMLInputElement>(`#${CSS.escape(input.id)}`)
      : null
    return field && isTextField(input) && input.value
      ? [[field, input.value] as const]
      : []
  })
}

/** The form the inline script held, if it is this form or the one it replaces. */
function takeHeldForm(form: HTMLFormElement) {
  const store = window as unknown as Record<string, HTMLFormElement | null>
  const held = store[HELD_FORM_PROPERTY]
  if (!held) return null
  const same = held === form
  const replaced =
    !held.isConnected &&
    held.getAttribute(EARLY_SUBMIT_ATTRIBUTE) ===
      form.getAttribute(EARLY_SUBMIT_ATTRIBUTE)
  if (!same && !replaced) return null
  store[HELD_FORM_PROPERTY] = null
  return held
}

/**
 * Report each value as an input event, one render at a time, so the form's
 * onChange handlers see it as they see a value typed later.
 */
function reportValues(values: TypedValues) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set
  if (!setValue) return
  for (const [input, typed] of values) {
    if (!input.isConnected) continue
    // React tracks the last value it saw through the element's own setter;
    // set that to the rendered value, then put the typed value back through
    // the prototype setter, so React reads the event as a change.
    input.value = input.defaultValue
    setValue.call(input, typed)
    flushSync(() => input.dispatchEvent(new Event('input', { bubbles: true })))
  }
}

/**
 * Props for an auth form that may be submitted before the page scripts run
 * (lib/auth/earlySubmit.ts). Spread them on the `<form>`.
 *
 * When React attaches the form, a submit the inline script held is sent once,
 * with `requestSubmit()`, so it takes the same path as a later press:
 * validation, the busy state, Convex Auth and its errors. If React handles
 * the held event itself, the capture handler clears the hold first, so the
 * submit is never sent twice.
 *
 * `kind` names the form (`login`, `register`, ...), so a form React renders
 * anew takes over the held submit of the one it replaces, and no other form
 * does.
 */
export function useEarlySubmit(
  kind: string,
  formRef?: RefObject<HTMLFormElement | null>
) {
  const ref = useCallback(
    (form: HTMLFormElement | null) => {
      if (formRef) formRef.current = form
      if (!form) return
      form.setAttribute(SCRIPTS_ACTIVE_ATTRIBUTE, '')
      const held = takeHeldForm(form)
      let typed = valuesFromBeforeScripts(form)
      if (held && held !== form) {
        typed = valuesFromReplacedForm(held, form)
        form.setAttribute(HELD_SUBMIT_ATTRIBUTE, '')
      }
      let submitTimer: ReturnType<typeof setTimeout> | undefined
      const replayTimer = setTimeout(() => {
        if (!form.isConnected) return
        reportValues(typed)
        // A separate task, so React has rendered those values before the
        // submit handler reads them.
        submitTimer = setTimeout(() => {
          if (!form.isConnected || !form.hasAttribute(HELD_SUBMIT_ATTRIBUTE))
            return
          form.removeAttribute(HELD_SUBMIT_ATTRIBUTE)
          form.requestSubmit()
        })
      })
      return () => {
        clearTimeout(replayTimer)
        clearTimeout(submitTimer)
        if (formRef) formRef.current = null
      }
    },
    [formRef]
  )
  return {
    ref,
    [EARLY_SUBMIT_ATTRIBUTE]: kind,
    onSubmitCapture: (event: FormEvent<HTMLFormElement>) => {
      event.currentTarget.removeAttribute(HELD_SUBMIT_ATTRIBUTE)
    },
  }
}
