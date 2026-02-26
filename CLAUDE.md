# CLAUDE.md — Project Instructions for Claude

## Project

QuillTip is a decentralized publishing platform where writers earn money through reader tips. Writers receive 97.5% of every tip via Stellar blockchain payments. Content is permanently stored on Arweave.

## Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Backend**: Convex (queries, mutations, actions in `convex/`)
- **Payments**: Stellar blockchain (Soroban smart contracts in `contracts/`)
- **Storage**: Arweave (permanent article storage)
- **Runtime**: bun
- **UI**: Tailwind CSS v4, Radix UI, shadcn/ui (`components/ui/`)
- **Editor**: Tiptap
- **Validation**: Zod
- **State**: Zustand
- **Testing**: Vitest, convex-test

## File Structure

```
app/            Next.js pages and routes
components/     React components (ui/ has shadcn primitives)
convex/         Backend functions (queries, mutations, actions, schema)
lib/            Shared utilities and helpers
contracts/      Soroban smart contracts (Rust)
public/         Static assets
docs/           Documentation
```

## Dev Commands

```bash
bun run dev           # Start Next.js + Convex in parallel
bun run lint          # ESLint (flat config)
bun run typecheck     # tsc --noEmit
bun run test:once     # Vitest single run
bun run format        # Prettier write
bun run format:check  # Prettier check (CI)
bun run build         # Next.js production build
```

## Code Style

- TypeScript for all new code. No `any` unless unavoidable.
- Tailwind CSS for styling. No inline styles or CSS modules.
- Use Radix UI / shadcn primitives from `components/ui/` before building custom components.
- Convex for backend. Queries, mutations, and actions in `convex/`.
- Zod for validation at system boundaries.
- Prefer named exports. One component per file.

## Anti-Slop Rules

- **No emojis** in code, logs, UI strings, or comments.
- **No buzzwords**: "leverage", "utilize", "streamline", "robust", "seamless", "cutting-edge", "world-class", "elevate", "empower", "synergy".
- **No filler comments**: Don't add comments that restate the code. Only comment when the logic is non-obvious.
- **No unnecessary abstractions**: Three similar lines of code are better than a premature helper function.
- **No commented-out code**: Delete it. Git has history.
- **No `console.log` in production paths**: Use proper error handling. `console.error` is acceptable for caught errors.

## Commit Conventions

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/). Enforced by commitlint.

- `feat:` new feature
- `fix:` bug fix
- `refactor:` code change that neither fixes a bug nor adds a feature
- `docs:` documentation only
- `style:` formatting, missing semicolons, etc.
- `test:` adding or updating tests
- `chore:` build process, dependencies, tooling

## Review Guidelines

When reviewing code, check for:

1. **Correctness**: Does it do what it claims? Edge cases handled?
2. **Type safety**: No `any`, proper generics, Zod schemas at boundaries.
3. **Security**: No XSS, no SQL injection, no secrets in code, input validation.
4. **Performance**: No unnecessary re-renders, proper memoization, efficient queries.
5. **Style compliance**: Matches the rules above. No slop.

## Testing

- Use Vitest for unit tests, convex-test for backend function tests.
- Bug fixes must include a regression test.
- Test files live next to the code they test (`*.test.ts` / `*.test.tsx`).
