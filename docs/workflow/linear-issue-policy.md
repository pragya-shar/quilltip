# Quilltip Linear Issue Policy

Conventions for filing and editing issues in the Quilltip Linear workspace. Applies to humans and agents.

## Workspace

- Workspace URL: `https://linear.app/bhvn`
- Team: `Engineering` with key `ENG`
- Default project: current Quilltip project
- Default target branch for code work: `development`

## Workflow

1. Research the report against the live codebase and current branch. Confirm the issue is still real before filing.
2. Check existing Linear issues for duplicates or parent/child coverage.
3. Check git history when the report might already be merged.
4. Propose the issue fields for review when the user asks for review before creating.
5. After approval, update Linear through the Linear tool. Do not stage issue text in a separate markdown file unless the user asks.

## Title

- Short, neutral, and easy to scan.
- State the problem or outcome, not the chat that surfaced it.
- One issue per title. Split separate problems.
- Avoid names, dates, chat references, "from the last call", or similar context.
- Use plain words. Avoid jargon where a direct phrase is enough.

## Description

Use this structure for normal issues:

```md
Short description of the current problem or intended outcome.

## Checklist

- [ ] Specific acceptance item
- [ ] Specific acceptance item
- [ ] Verification or evidence item
```

Guidelines:

- Lead with current behavior and expected behavior for bugs.
- For feature work, lead with the smallest useful outcome.
- Add suspected cause and relevant code paths only when known.
- Mention files, components, functions, or flows only when confident.
- Avoid line numbers because they drift.
- Do not paste chat transcripts.
- Do not overstate grant, GTM, or traction claims. Testnet activity stays testnet activity.

## Status

Use Linear workflow states only:

- `Backlog` for work that needs reproduction, triage, or scoping.
- `Todo` for scoped work ready to pick up.
- `In Progress` for active work.
- `In Review` for review or merge readiness.
- `Done` for completed work.
- `Canceled` for work no longer planned.
- `Duplicate` for duplicate issues.

Do not invent custom states. Map "blocked" to `Backlog` or `Todo` plus a `Blocked by` relation.

## Priority

Use Linear default priorities:

- `Urgent` for active production breakage, release blocker, security issue, or a hard dependency that blocks the next required step.
- `High` for visible regression, demo blocker, beta blocker, or near-term project dependency.
- `Medium` for real but non-blocking work.
- `Low` for polish, nice-to-have work, or edge cases.

Map P0/P1/P2/P3 if seen in a source: P0 to Urgent, P1 to High, P2 to Medium, P3 to Low.

## Assignee

- Use the assignee requested by the user.
- For Pragya-owned work, assign to `sharmapragya997@gmail.com`.
- Leave unassigned if ownership is unclear.
- Do not assign to a third party without explicit confirmation.

## Labels

Use labels that exist on the team:

- `Bug` for incorrect behavior, broken flows, or regressions.
- `Feature` for a new capability.
- `Improvement` for an enhancement to an existing feature or process.

Do not invent labels until they exist in Linear.

## Relationships

- Use `Blocked by` when another issue must ship first.
- Use `Blocks` when this issue unlocks another issue.
- Use `Related to` for adjacent work that should be coordinated but is not a hard dependency.
- Preserve existing relations unless the user explicitly asks to remove them.
- For parent/sub-issue reviews, include a parent/sub-issue count table when reporting back.

## Quilltip-Specific Rules

- Keep contract, backend verification, UI, QA, performance, outreach, and submission-packet work separate when they can ship independently.
- Do not mix code tasks with private evidence-gathering tasks unless the same outcome truly requires both.
- For Stellar work, say whether the task is article tipping, highlight tipping, batch settlement, wallet UX, verification, or contract code.
- For Arweave work, call out permanence risks.
- For GTM, SCF, or external-facing work, separate testnet validation from production or mainnet claims.
- For QA findings, file only concrete blockers or regressions. Defer polish unless the user asks for it.

## Style Rules

- No emoji.
- No em dashes.
- ASCII-friendly punctuation.
- Use concise bullets.
- Do not invent scope or product direction inside an issue.
- Make every issue actionable.

## Anti-Patterns

- Filing the same issue twice because it appeared in two places.
- Copying a chat transcript into Linear.
- Splitting one bug into both a Bug and a Feature.
- Marking everything Urgent.
- Filing a broad "fix QA" issue when concrete blocker issues are needed.
