---
name: paper-workbench
description: Use this skill when the user provides a paper PDF, DOI, title keywords, or asks to add/manage/read papers in a local paper workbench. This skill manages a nearby folder named paper-reader-ai-branch, creates or updates paper entries, organizes original PDFs/translations/notes, and keeps the web app data in sync. Trigger for requests like "用 paper-workbench 处理", "导入这篇论文", "根据这个 PDF 建条目", "根据关键词补全论文信息", "生成论文摘要/翻译/笔记并更新工作台", or any request to manage a paper-reader-ai-branch workspace.
---

# Paper Workbench

This skill operates on a local workspace folder named `paper-reader-ai-branch`.

## Finding the workspace

Look for the workspace in this order:

1. A user-provided path
2. `./paper-reader-ai-branch`
3. A sibling or nearby folder named `paper-reader-ai-branch`

If none exists, tell the user you need the workspace path or create a new one in the current working directory if they asked you to set it up.

## What this skill owns

- `data/papers.json`
- `summaries/papers-overview.csv`
- `papers/<category>/<paper-id>/original`
- `papers/<category>/<paper-id>/translation/zh-CN.md`
- `papers/<category>/<paper-id>/notes/reading-note.md`

## Default workflow

1. Read `data/papers.json`.
2. If the user gives a PDF:
   - create or update a paper entry
   - store the PDF under `papers/.../original`
3. If the user gives keywords / title / DOI:
   - find an existing entry or create a draft with `aiStatus=待AI整理`
4. If the user asks for content generation:
   - update `summary`
   - update `takeaways`
   - update `focus`
   - update `translation/zh-CN.md`
   - update `notes/reading-note.md`
   - set `aiStatus` according to progress, usually `已完成` after all requested outputs are done
5. Save `data/papers.json` and keep `summaries/papers-overview.csv` consistent.

## Operating rules

- Prefer controlled updates over fragile automatic metadata guessing.
- Do not invent bibliographic facts.
- If metadata is uncertain, leave it blank or mark it pending.
- Update existing files in place instead of creating duplicates.
- Keep categories short and practical.

## Typical user intents

- “用 paper-workbench 处理这个 PDF”
- “把这篇论文加入工作台并生成摘要”
- “根据这些关键词建一个论文条目”
- “帮我补全这篇论文的中文翻译和阅读笔记”
- “更新工作台里的某篇论文信息”

