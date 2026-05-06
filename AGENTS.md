# AGENTS.md — Project instructions for Codex

## Context
- Timezone: America/New_York
- Priorities: correctness > maintainability > speed
- Prefer small PRs and incremental changes

## Workflow
1. Scan relevant files first; don't change unrelated code.
2. Propose a short plan (3-6 bullets).
3. Implement in small diffs; keep naming and style consistent.
4. Add or adjust tests for new behavior.
5. Run: format/lint + targeted tests, or explain what to run.

## Coding standards
- Keep functions small and readable.
- Avoid breaking public APIs without calling it out.
- Add comments only where they explain why, not what.

## When unsure
- Ask one precise question, or present two options with tradeoffs and a recommendation.
