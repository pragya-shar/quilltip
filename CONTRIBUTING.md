# Contributing to QuillTip

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Getting Started

1. Fork the repository
2. Clone your fork and set up the dev environment:

```bash
git clone https://github.com/<your-username>/QuillTip.git
cd QuillTip
bun install
cp .env.example .env.local
npx convex dev --once
npx convex env set SITE_URL http://localhost:3000
bun run dev
```

See [docs/SETUP.md](docs/SETUP.md) for full environment details.

## Development Workflow

1. Create a branch from `main`:

```bash
git checkout -b feature/your-feature
```

1. Make your changes. Run checks before committing:

```bash
bun run lint
bun run typecheck
bun test
```

1. Commit with a clear message:

```bash
git commit -m "feat: add highlight color picker"
```

1. Push and open a PR against `main`.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `docs:` — documentation only
- `style:` — formatting, missing semicolons, etc.
- `test:` — adding or updating tests
- `chore:` — build process, dependencies, tooling

## Code Style

- **TypeScript** for all new code
- **Tailwind CSS** for styling — no inline styles or CSS modules
- **Radix UI / shadcn** for UI primitives — check `components/ui/` before building custom components
- **Convex** for backend — queries, mutations, and actions in `convex/`
- **Zod** for validation at system boundaries
- Run `bun run lint` and `bun run typecheck` before submitting

## Project Structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full breakdown. Key directories:

- `app/` — Next.js pages and routes
- `components/` — React components
- `convex/` — Backend functions
- `lib/` — Shared utilities
- `contracts/` — Soroban smart contracts (Rust)

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Include a description of what changed and why
- Add screenshots for UI changes
- Make sure CI passes (lint, typecheck, tests)

## Reporting Issues

Open an issue with:

- A clear title
- Steps to reproduce (if it's a bug)
- Expected vs actual behavior
- Browser/OS if relevant

## Areas for Contribution

Some areas where help is welcome:

- UI/UX improvements
- Test coverage
- Accessibility
- Documentation
- Performance optimization
- New reader/writer features

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
