# Workflow Contract

Use this file for strict execution rules and quality thresholds.

## Record contract

Keep UI-facing fields synchronized:

- Identity: `id`, `title`, `titleZh`, `authors`, `year`, `venue`, `doi`, `category`
- Content: `summary`, `takeaways`, `focus`
- State: `aiStatus`, `readingStatus`, `starred`
- QA: `qaCount`, `conversationLog`
- Time: `importedAt`, `publishedAt`, `lastOpenedAt`

Normalize date fields to `YYYY-MM-DD` for summary/table usage.
Default `readingStatus=待读` for new entries unless user specifies another state.

## Status progression

Advance by completion:

`待元数据` → `待摘要` → `待翻译` → `待笔记` → `待校对` → `已完成`

Do not force `已完成` when required artifacts are missing.

## Mandatory behavior

- Use draft-first flow so cards appear before heavy generation completes.
- Preserve deterministic structure in generated markdown sections.
- Keep reruns idempotent and update-in-place.
- Keep QA sink append-only.
- After QA sink, verify:
  - `qaCount` increases
  - `conversationLog` path exists
  - notes contain QA additions (API path does this automatically)

## Translation mode gate

- If user did not specify mode, ask only:
  - `要全文翻译还是精简翻译？`
- Execute remaining stages without extra step confirmations.

## Quality bar

### Summary

- Use 3-part structure: problem, method/evidence, conclusion/boundary.
- Provide at least 5 concrete takeaways.
- State at least 1 limitation or validity condition.

### Translation

- Respect user-selected mode:
  - `精简翻译`: abstract + core method/result coverage, concise but complete meaning.
  - `全文翻译`: cover all extractable text.
- Include terminology mapping.
- Mark uncovered sections when extraction is incomplete.

## Failure handling

### PDF parsing failure

1. Retry with alternate extraction path once.
2. Fallback to filename hints + user keywords.
3. Persist draft with `aiStatus=待元数据` and list pending metadata.

### Partial generation failure

- Keep completed artifacts.
- Keep `aiStatus` at last completed stage.
- Report exact retry point.
- Never delete valid existing outputs because one stage fails.
