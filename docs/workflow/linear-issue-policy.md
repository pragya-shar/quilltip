# Linear issue conventions

Workspace: [bhvn](https://linear.app/bhvn). Team: Engineering (`ENG`). Use the
current QuillTip project; code work targets `main`.

## Before creating or updating

Verify the report against the current code/history and check existing issues for
duplicates or parent/sub-issue coverage. Make authorized edits through the Linear
tool; a request to draft or review an issue does not authorize publishing it.
Use live team metadata for available states, labels, projects, and members.

## Content

- Give each independently shippable outcome a short, neutral title.
- Lead with current and expected behavior, then a small acceptance checklist with
  verification. Include known file/function references; omit drifting line numbers
  and chat transcripts. Keep scope factual rather than inventing product direction.
- Separate contract, backend, UI, QA, performance, private evidence, and outreach
  work when each can ship independently. Identify article tips, highlight tips,
  batch settlement, wallet UX, or contract work explicitly.
- Apply the testnet/mainnet and Arweave constraints in [AGENTS.md](../../AGENTS.md).

## Fields and relationships

| Field     | Convention                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status    | Backlog for triage, Todo when scoped, In Progress while active, In Review for review, Done when complete; Canceled/Duplicate when applicable.                          |
| Blocked   | Use a `Blocked by` relation and the appropriate existing state.                                                                                                        |
| Priority  | Urgent: active breakage/security/release blocker; High: visible regression or near-term blocker; Medium: non-blocking work; Low: polish. Map P0/P1/P2/P3 respectively. |
| Assignee  | Use requested ownership. Pragya-owned work maps to `sharmapragya997@gmail.com`; otherwise leave unassigned. Third-party assignment needs confirmation.                 |
| Labels    | Use existing Bug, Feature, or Improvement labels as appropriate; check live metadata before inventing values.                                                          |
| Relations | Preserve existing links. Use Blocks/Blocked by for dependencies and Related to for adjacent work. Report parent/sub-issue counts when reviewing a hierarchy.           |

Keep issue text concise, with plain words and ASCII-friendly punctuation. File
concrete QA blockers/regressions; include polish only when requested.
