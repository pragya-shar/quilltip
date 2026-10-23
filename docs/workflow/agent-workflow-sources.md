# Agent workflow sources

Reviewed 2026-10-23. These are first-party engineering accounts and live product
documentation, selected for applicability to QuillTip. They represent practices
from these teams, not a ranking or an identical setup used by every engineer.
Project choices below are adaptations; model-specific recipes and large-team
infrastructure are not prerequisites.

## Applied decisions

| Decision                                                                                 | Where it lives                                   | Primary evidence                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| One concise shared instruction source, with task-based links                             | `AGENTS.md`; `CLAUDE.md` imports it              | Lopopolo, Provencher, Shihipar; instruction-loading docs below |
| Proportional explore/plan/implement/verify loop                                          | [workflow](repo-workflow.md)                     | Claude Code best practices; Friel/Huet account                 |
| Small iteration checks and one final code/tooling command                                | `package.json` (`check`); existing hooks and CI  | Lopopolo; Provencher; Claude Code best practices               |
| Real route/backend evidence and explicit coverage limits                                 | [QA](qa-checklist.md); [setup](../SETUP.md)      | Young; Rajasekaran; Claude Code team review                    |
| Concrete review findings; re-review affected work, reconsider repeated failed approaches | [workflow](repo-workflow.md)                     | Claude Code team review                                        |
| Skills for recurring specialist tasks; compact long-task handoffs                        | [workflow](repo-workflow.md)                     | Provencher; Shihipar; Lewi                                     |
| Verify consumers before pruning; preserve operational safeguards                         | Environment template and linked domain/CI guides | Roim                                                           |

## Engineering accounts

| Author/team and date                                               | Source                                                                                                                                       | Applicable practice                                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Ryan Lopopolo, OpenAI, 2026-02-11                                  | [Harness engineering](https://openai.com/index/harness-engineering/)                                                                         | Short repository map, deeper versioned knowledge, mechanical checks, observable app behavior.                  |
| Eric Provencher, OpenAI, 2026-09-11                                | [Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)                            | Precise skill triggers, progressive disclosure, pruning stale instructions and unnecessary tests.              |
| Rodrigo Roim, OpenAI, 2026-10-14                                   | [Maintaining software](https://learn.chatgpt.com/blog/maintaining-software-with-the-gpt-6-family)                                            | Inspect consumers, history, and active configuration before deleting apparent dead weight.                     |
| Jeremy Lewi, OpenAI, 2026-08-25                                    | [Automating repetitive work](https://developers.openai.com/blog/automating-repetitive-work-at-openai-with-codex)                             | Discoverable, repeatable workflows with review boundaries and recorded results.                                |
| Aaron Friel and Romain Huet, official Forum account, 2025-12-04    | [Big projects with rigor](https://forum.openai.com/public/blogs/how-openai-engineers-use-codex-to-tackle-big-projects-with-rigor-2025-12-04) | Living plans and requirement/test tracking for long work. This is an event account, not a verbatim transcript. |
| Thariq Shihipar, Anthropic, 2026-07-24                             | [Context engineering for Claude 5](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)              | Lean instructions focused on gotchas; load specialist context on demand.                                       |
| Addy Osmani, Morgan Westlee Lunt, Qing Wang, Anthropic, 2026-10-15 | [How the Claude Code team reviews code](https://claude.dev/blog/solving-code-review-at-anthropic/)                                           | Verify executable results and actionable findings; bound repeated review cycles.                               |
| Justin Young, Anthropic, 2025-11-26                                | [Effective long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)                        | Incremental work, progress handoffs, and browser evidence beyond unit-test success.                            |
| Prithvi Rajasekaran, Anthropic, 2026-03-24                         | [Long-running app development](https://www.anthropic.com/engineering/harness-design-long-running-apps)                                       | Separate implementation from skeptical evaluation; interact with the real UI.                                  |

## Current product references

- [Codex instruction discovery](https://developers.openai.com/codex/guides/agents-md):
  repository/nested instruction loading and overrides.
- [Claude Code memory and imports](https://code.claude.com/docs/en/memory):
  `@AGENTS.md` shares instructions across tools and supports sessions without
  native AGENTS loading. Avoid duplicate manuals and machine-specific overrides.
- [Claude Code best practices](https://code.claude.com/docs/en/best-practices):
  observable success, proportional planning, short instructions, and deterministic
  hooks. The original Anthropic engineering best-practices URL redirects here.

Boris Cherny's original workflow thread on X could not be fetched (HTTP 403), so
its details are not direct evidence for this setup. The current official team
review post corroborates and cites his emphasis on verification. Keep source
dates separate from live documentation, and revisit this note when the workflow
changes rather than accumulating another instruction layer.
