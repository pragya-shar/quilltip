# React component organization

Define one component per file in `app/` and `components/`. This includes private
helpers, loading skeletons, error fallbacks, and class components. Extract a helper
beside its parent; place helpers for Next.js route entries in the appropriate
`components/` directory. Prefer named exports, retaining required Next.js default
exports.

## Exceptions and scope

- Compound Radix/shadcn primitive modules in `components/ui/` stay together. Their
  parts form one shared primitive API, often with shared context. This directory
  exception also covers primitive support modules such as chart helpers. It is
  not a place for application components.
- Hooks, types, constants, and non-component utilities can accompany a component.
  Shared non-component declarations can live in a sibling support module.
- JSX values (for example an error boundary's `fallback` value) and render
  callbacks are not separate component definitions.
- `next/dynamic` and `React.lazy` aliases do not define a second component. Keep
  their import paths and loading options intact. Inline loading callbacks may
  remain at their lazy-loading boundary.
- Compatibility modules may re-export multiple components. Re-exporting does not
  define a component; existing import paths should continue working.
- Test and spec fixtures are outside this production convention.

## Enforcement and review

`bun run lint` enforces `local/one-component-per-file` for TypeScript modules in
`app/` and `components/`, with the directory and test exceptions above. The rule
recognizes top-level PascalCase JSX-bearing functions, arrow functions,
`memo`/`forwardRef` wrappers (including `React.memo`/`React.forwardRef`), and React
component classes. It deliberately does not attempt to infer components from
arbitrary factories, aliases, or functions with no direct JSX. Review those cases
manually; the convention still applies. Nested render callbacks are not counted.
Anonymous default function and arrow exports are also counted. Run
`bun run test:component-organization` for the policy fixtures; CI runs them beside
lint. These tooling checks use Node's built-in test runner.

When reviewing an extraction, verify props, keys, refs, DOM markup, client/server
directives, error boundaries, and lazy-loading boundaries remain intact. Avoid
parent/child circular imports: move shared types or constants into a sibling
support module. Prefer direct imports internally; retain re-exports only where
needed to preserve the public import surface.

Issue #242 audited the 56-file shortlist from PR #241. The semantic audit also
includes class components, which found `components/account/ActivityBoundary.tsx`.
Dynamic aliases and fallback JSX values from the original shortlist do not need
extraction. The remaining application definitions are split; compound primitives
remain under the explicit exception above.
