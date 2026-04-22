---
name: paper-workbench
description: "AI-first paper ingestion and lifecycle management for paper-reader-ai-branch workspaces. Use when the user asks to process paper PDFs, DOI, title keywords, or existing paper records; generate or update summary/translation/notes; update metadata/status/star/read state; or sink paper Q&A into QA logs and notes."
---

# Paper Workbench

Execute paper workflows end-to-end and keep workbench data plus web UI state consistent.

## Run mode

- Execute continuously after receiving a paper source (`PDF`, `DOI`, `title`, `keywords`).
- Avoid stage-by-stage confirmation prompts.
- Ask exactly one blocking question when translation scope is missing: `要全文翻译还是精简翻译？`.
- Ask additional questions only when blocked (missing source, ambiguous target paper, or write failure).
- Continue with explicit assumptions when ambiguity is non-blocking.

## Resolve workspace

- Resolve workbench root in this order:
  1. User-provided path
  2. `PAPER_WORKBENCH_ROOT`
  3. `./paper-reader-ai-branch`
  4. `../paper-reader-ai-branch`
  5. `/Volumes/WD_extend/workspace/codex/paper-reader-ai-branch`
- Create `./paper-reader-ai-branch` only when user intent is setup/init.
- Stop and report missing root when user asked for immediate processing but no valid root exists.

## Execute workflow

1. Load current snapshot (`GET /api/papers` or file fallback).
2. Resolve identity (DOI → normalized title → fuzzy candidate).
3. Persist a visible draft first so UI card appears immediately.
4. Enrich metadata without fabrication.
5. Generate outputs stage-by-stage (summary → translation → notes), persisting after each stage.
6. Sink paper Q&A in the same run (`POST /api/papers/qa` or append-only file fallback).
7. Reconcile status progression and verify final data consistency.

## Enforce invariants

- Prefer API-first updates and incremental persistence.
- Keep updates idempotent; update existing entries instead of forking duplicates.
- Keep bibliographic uncertainty explicit; never fabricate facts.
- Keep `starred` as boolean.
- Keep QA append-only unless user explicitly requests deletion.
- Verify `qaCount` and `conversationLog` after QA sink; retry once if needed.

## Report completion

- Return concise execution summary.
- Include updated `paper-id`, translation mode, current `aiStatus`, changed artifacts, and pending uncertainty/retry point.

## Load references on demand

- Load API endpoints, payload shapes, and file fallback mapping from [references/api-and-files.md](references/api-and-files.md).
- Load status/field contracts, quality bar, and failure policy from [references/workflow-contract.md](references/workflow-contract.md).
