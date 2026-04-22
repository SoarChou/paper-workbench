# API and File Mapping

Use API-first writes whenever the local workbench service is reachable.

## API endpoints

- `GET /api/papers`: read current snapshot.
- `POST /api/papers`: create or upsert draft/record with optional uploads.
- `POST /api/papers/open`: update `lastOpenedAt`.
- `POST /api/papers/patch`: patch metadata/status/star fields.
- `POST /api/papers/content`: write `translation` or `notes` markdown.
- `POST /api/papers/qa`: append QA log and sync notes QA section.
- `POST /api/papers/delete`: delete selected paper IDs.
- `GET /api/events`: SSE channel for `paper-updated`.

## API payload essentials

### `POST /api/papers`

- Use `multipart/form-data`.
- Important fields:
  - `paperId` (optional for create, required for update)
  - `title` (required unless inferable from uploaded PDF filename)
  - `titleZh`, `authors`, `venue`, `doi`, `category`, `year`, `publishedAt`
  - `readingStatus`, `aiStatus`, `summary`, `focus`, `takeaways`
  - `originalFile`, `translationFile`, `notesFile`
  - `translationText`, `notesText`
- Recommended: create draft as early as possible with minimal metadata.

### `POST /api/papers/patch`

```json
{
  "paperId": "2024-sample-paper",
  "patch": {
    "titleZh": "示例论文",
    "category": "LLM",
    "year": 2024,
    "publishedAt": "2024-06-01",
    "aiStatus": "待翻译",
    "readingStatus": "待读",
    "starred": true,
    "venue": "ICLR",
    "doi": "10.xxxx/xxxx"
  }
}
```

### `POST /api/papers/content`

```json
{
  "paperId": "2024-sample-paper",
  "kind": "translation",
  "content": "# 中文翻译\n..."
}
```

- `kind` only accepts `translation` or `notes`.

### `POST /api/papers/qa`

Single item:

```json
{
  "paperId": "2024-sample-paper",
  "question": "核心创新是什么？",
  "answer": "..."
}
```

Batch items:

```json
{
  "paperId": "2024-sample-paper",
  "qaItems": [
    { "question": "Q1", "answer": "A1" },
    { "question": "Q2", "answer": "A2" }
  ]
}
```

## File fallback ownership

When API is unavailable, update these files incrementally:

- `data/papers.json`
- `summaries/papers-overview.csv`
- `papers/<category>/<paper-id>/original/*.pdf`
- `papers/<category>/<paper-id>/translation/zh-CN.md`
- `papers/<category>/<paper-id>/notes/reading-note.md`
- `papers/<category>/<paper-id>/notes/qa-log.md`

Apply draft-first behavior in fallback mode as well:

1. Create/update draft in `papers.json` + `papers-overview.csv` first.
2. Persist each generated stage immediately.
3. Keep append-only QA behavior.
