---
name: paper-workbench
description: Use this skill when the user provides a paper PDF, DOI, title keywords, or asks to add/manage/read papers in a paper workbench. This skill runs an AI-first pipeline: ingest source, resolve metadata, generate summary/translation/notes, update statuses, and sync web-visible data. Trigger for requests like "用论文工作台处理", "导入这篇论文", "根据 PDF 建条目", "根据关键词补全论文信息", "生成摘要翻译笔记并回填", or any request to operate a paper-reader-ai-branch workspace.
---

# Paper Workbench

Use this skill when the paper workbench is the source of truth and the UI is only for display/manage.

## Workspace resolution (portable first)

Resolve workbench root in this order:

1. User-provided explicit path
2. `PAPER_WORKBENCH_ROOT` env var (if set)
3. `./paper-reader-ai-branch`
4. Sibling `../paper-reader-ai-branch`
5. Fallback default: `/Volumes/WD_extend/workspace/codex/paper-reader-ai-branch`

If no path exists and user intent is “set up/init”, create `./paper-reader-ai-branch` and proceed.
If no path exists and user asked to process immediately, report the missing workspace path and stop.

## Execution mode (important)

- Default to **continuous execution**. Once user gives PDF/title/keywords/DOI, run the full needed pipeline directly.
- Do **not** ask step-by-step confirmation like “要不要继续下一步”.
- **Translation mode gate (single question only):** if translation scope is not explicitly specified, ask exactly one blocking question: `要全文翻译还是精简翻译？`.
- After the user chooses translation mode, continue end-to-end without further stage-by-stage confirmations.
- Only ask when truly blocked (missing source file, conflicting target, write permission failure).
- When assumptions are made (match candidate, inferred title, inferred venue), continue execution and report assumptions explicitly.

## Efficient execution (API-first)

- Prefer **batch API updates** over fragmented manual edits when service is running.
- Preferred API path:
  - `GET /api/papers` for snapshot + candidate matching
  - `POST /api/papers` for upsert/import
  - `POST /api/papers/patch` for metadata/status/star updates
  - `POST /api/papers/content` for translation/notes content writes
  - `POST /api/papers/qa` for batched Q&A沉淀 (`qaItems[]` supported)
- **Draft-first rule (mandatory):** when user gives a new PDF/keywords/DOI, create a visible draft record first, then run heavy generation.
  - API mode: call `POST /api/papers` immediately with minimal metadata and source info so the card appears in UI.
  - Then update stage-by-stage (`aiStatus`, translation, notes, QA) via patch/content/qa endpoints.
- If API is unavailable, fallback to direct file updates **incrementally**:
  - write draft to `data/papers.json` + `summaries/papers-overview.csv` first
  - then update the same record after each stage (not end-only one-shot write)
- Do not ask users逐步确认每个阶段；默认一次执行到底并回报结果。

## What this skill owns

- `data/papers.json`
- `summaries/papers-overview.csv`
- `papers/<category>/<paper-id>/original`
- `papers/<category>/<paper-id>/translation/zh-CN.md`
- `papers/<category>/<paper-id>/notes/reading-note.md`
- `templates/summary-template.md` (if exists)
- `templates/translation-template.md` (if exists)
- `templates/notes-template.md` (if exists)
- `papers/<category>/<paper-id>/notes/qa-log.md`

## Record contract

Keep entries compatible with the workbench UI. Prefer keeping these fields up to date:

- `id`, `title`, `titleZh`, `authors`, `year`, `venue`, `doi`, `category`
- `summary`, `takeaways`, `focus`
- `aiStatus`, `readingStatus`
- `starred`, `qaCount`, `conversationLog`
- `importedAt`, `publishedAt`, `lastOpenedAt`

Date format should be normalized to `YYYY-MM-DD` when stored or rendered in summary contexts.
For new entries, default `readingStatus=待读` unless user explicitly sets another status.

## Default workflow

1. Load current snapshot (`GET /api/papers` if available, otherwise `data/papers.json`).
2. Resolve paper identity:
   - dedupe by DOI first
   - then normalized title
   - then fuzzy title/keywords candidate
3. Ingest source:
   - for PDF input, store source file under `papers/<category>/<paper-id>/original`
   - for keyword/DOI input, prepare draft fields with pending metadata
4. **Persist draft immediately (UI-first):**
   - create/update draft entry now, so frontend can show the paper card before translation/notes finish
   - set initial `aiStatus` to the earliest pending stage
5. Resolve metadata (best-effort, no fabrication):
   - filename/title hints
   - first-page text
   - DOI regex in text
   - user-provided keywords/context
6. Generate and sync stage-by-stage:
   - `summary`, `takeaways`, `focus`
   - `translation/zh-CN.md`
   - `notes/reading-note.md`
   - prefer templates if present
   - after each stage, persist update and advance `aiStatus`
7. Sync conversation memory when available:
   - If current turn includes paper-related Q&A, append to `POST /api/papers/qa` in batch mode.
   - Ensure QA entries are also沉淀到 `notes/reading-note.md` (via API or fallback file append).
8. Update status progression:
   - `待元数据` → `待摘要` → `待翻译` → `待笔记` → `待校对` → `已完成`
9. Final persistence check:
   - ensure `data/papers.json` and `summaries/papers-overview.csv` are synced
   - ensure UI-visible fields are consistent with generated artifacts

## Operating rules

- Prefer controlled updates over fragile automatic metadata guessing.
- Do not invent bibliographic facts.
- If metadata is uncertain, leave it blank or mark it pending.
- Update existing files in place instead of creating duplicates.
- Keep categories short and practical.
- If a field is still missing, prefer a pending status over guessing.
- When content is generated, keep the section headings stable so the web UI and future Codex runs can continue from the same structure.
- If multiple likely matches exist, choose the highest-confidence candidate and explicitly report the assumption.
- Keep output deterministic and idempotent: reruns should update, not fork duplicate entries.
- Star/favorite updates should use `starred` boolean only (no custom strings).
- Q&A沉淀 should be append-only; never delete existing validated QA logs unless user explicitly requests.

## Quality bar (summary + translation)

- Summary quality:
  - provide a structured 3-part summary (problem / method-evidence / conclusion-boundary)
  - include at least 5 concrete takeaways (avoid generic wording)
  - explicitly include at least 1 limitation or validity condition
- Translation quality:
  - obey user-selected mode (`全文翻译` or `精简翻译`) from the single translation-mode question
  - `精简翻译`: cover abstract + core sections with concise but complete meaning preservation
  - `全文翻译`: translate the full paper text that is available from source extraction
  - include a terminology mapping section
  - if extraction is incomplete, clearly mark uncovered parts and keep status at the last completed stage

## Failure handling and fallback

- If PDF parsing fails:
  1) retry with alternate extraction path once
  2) fallback to filename + user keywords
  3) still create/update draft entry with `aiStatus=待元数据` and clearly report pending fields
- If translation/notes generation partially fails:
  - keep completed outputs
  - keep `aiStatus` at the last completed stage (do not mark `已完成`)
  - report retry point explicitly
- Never delete existing valid outputs just because one stage failed.

## Typical user intents

- “直接按 paper-workbench 处理这篇论文”
- “我只给你 PDF，你自动做完整流程”
- “文件名不规范，你也帮我补全信息”
- “把这篇论文加入工作台并生成摘要”
- “根据这些关键词建一个论文条目”
- “帮我补全这篇论文的中文翻译和阅读笔记”
- “更新工作台里的某篇论文信息”

## Minimal interaction policy

- Prefer action over questioning.
- Ask at most one blocking question at a time.
- If non-blocking ambiguity exists, choose the highest-confidence path and continue.

## Quick examples

Example A — User gives only PDF:

- Input: “按 paper-workbench 处理这个 PDF”
- Output: create/update one `paper-id`, save original PDF, infer metadata best-effort, generate requested artifacts, sync json/csv, return concise summary.

Example B — User gives only keywords:

- Input: “根据关键词建条目并生成摘要”
- Output: fuzzy match existing entry or create draft, generate summary/takeaways/focus, set status to the correct stage, report pending bibliography.

## Expected response style

- Return a concise completion summary, not a long decision tree.
- Clearly state: updated `paper-id`, changed files, current `aiStatus`, and any pending uncertainties.
