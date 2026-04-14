from __future__ import annotations

import csv
import html
import json
import os
import re
import shutil
import threading
import time
from collections import deque
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cgi


ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
PAPERS_JSON = DATA_DIR / "papers.json"
SUMMARY_CSV = ROOT_DIR / "summaries" / "papers-overview.csv"
PAPERS_DIR = ROOT_DIR / "papers"
WEB_DIR = ROOT_DIR / "web"

EVENTS_LOCK = threading.Lock()
EVENTS: deque[dict] = deque(maxlen=100)
STOP_WORDS = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "via", "with"}


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    cleaned = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", lowered)
    return cleaned.strip("-") or f"paper-{int(time.time())}"


def clean_text(value: str) -> str:
    cleaned = html.unescape((value or "").strip())
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def safe_filename(name: str, fallback: str) -> str:
    candidate = Path(name or fallback).name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", candidate).strip(".-")
    return cleaned or fallback


def derive_title_year_from_filename(filename: str) -> tuple[str, int | None]:
    stem = Path(filename).stem
    segmented = re.split(r"[-_]{3,}|[—–]{2,}", stem, maxsplit=1)
    if len(segmented) > 1 and segmented[1].strip():
        stem = segmented[1].strip()
    normalized = re.sub(r"[_+.]+", " ", stem)
    normalized = re.sub(r"-+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return ("Untitled Paper", None)

    year_match = re.search(r"\b(19|20)\d{2}\b", normalized)
    year = int(year_match.group(0)) if year_match else None
    if year_match:
        normalized = re.sub(rf"\b{year}\b", "", normalized).strip(" -")

    words = normalized.split()
    if not words:
        return ("Untitled Paper", year)

    title_words = []
    for index, word in enumerate(words):
        lower = word.lower()
        if word.isupper():
            title_words.append(word)
        elif lower in {"sok", "tls", "http", "https", "ml", "ai", "iot", "dns", "vpn"}:
            title_words.append(lower.upper())
        elif index > 0 and lower in STOP_WORDS:
            title_words.append(lower)
        else:
            title_words.append(lower.capitalize())
    title = " ".join(title_words)
    title = re.sub(r"^[A-Z][a-z]+(?:\s+等)?\s+(?=[A-Z]{2,}\b)", "", title).strip()
    return (title or "Untitled Paper", year)


def ensure_text_file(path: Path, content: str, default_content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = (content or "").strip()
    if text:
        path.write_text(text + "\n", encoding="utf-8")
    elif not path.exists():
        path.write_text(default_content, encoding="utf-8")


def persist_upload(file_item: cgi.FieldStorage, destination: Path, fallback_name: str) -> str | None:
    if not getattr(file_item, "filename", None):
        return None
    filename = safe_filename(file_item.filename, fallback_name)
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / filename
    with target.open("wb") as handle:
        shutil.copyfileobj(file_item.file, handle)
    return filename


def default_summary(title: str) -> str:
    return f"《{title}》已入库，待我为你补全摘要、翻译和阅读笔记。"


def default_translation(title: str) -> str:
    return f"# {title}\n\n## 中文翻译\n\n- 待 AI 生成。\n"


def default_notes(title: str) -> str:
    return (
        f"# 阅读笔记：{title}\n\n"
        "## 一句话总结\n\n- 待 AI 生成。\n\n"
        "## 核心问题\n\n- 待 AI 生成。\n\n"
        "## 方法与实验\n\n- 待 AI 生成。\n"
    )


def load_papers() -> list[dict]:
    if not PAPERS_JSON.exists():
        return []
    with PAPERS_JSON.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_summary_csv(papers: list[dict]) -> None:
    SUMMARY_CSV.parent.mkdir(parents=True, exist_ok=True)
    with SUMMARY_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "paper_id",
                "category",
                "year",
                "title",
                "authors",
                "venue",
                "doi",
                "ai_status",
                "reading_status",
                "original",
                "translation",
                "notes",
            ]
        )
        for paper in papers:
            writer.writerow(
                [
                    paper.get("id", ""),
                    paper.get("category", ""),
                    paper.get("year", ""),
                    paper.get("title", ""),
                    paper.get("authors", ""),
                    paper.get("venue", ""),
                    paper.get("doi", ""),
                    paper.get("aiStatus", "待AI整理"),
                    paper.get("readingStatus", "待读"),
                    paper.get("original", "") or paper.get("originalUrl", ""),
                    paper.get("translation", ""),
                    paper.get("notes", ""),
                ]
            )


def save_papers(papers: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with PAPERS_JSON.open("w", encoding="utf-8") as handle:
        json.dump(papers, handle, ensure_ascii=False, indent=2)
    write_summary_csv(papers)


def present_paper(paper: dict) -> dict:
    display = dict(paper)
    display["title"] = clean_text(display.get("title", ""))
    display["titleZh"] = clean_text(display.get("titleZh", "")) or display["title"]
    display["authors"] = clean_text(display.get("authors", ""))
    display["venue"] = clean_text(display.get("venue", ""))
    display["summary"] = clean_text(display.get("summary", "")) or default_summary(display["title"] or "未命名论文")
    display["focus"] = clean_text(display.get("focus", ""))
    display["aiStatus"] = display.get("aiStatus", "待AI整理") or "待AI整理"
    display["readingStatus"] = display.get("readingStatus", "待读") or "待读"
    display["takeaways"] = [clean_text(item) for item in display.get("takeaways", []) if clean_text(item)]
    return display


def present_papers(papers: list[dict]) -> list[dict]:
    return [present_paper(paper) for paper in papers]


def push_event(event_type: str, paper_id: str) -> None:
    with EVENTS_LOCK:
        EVENTS.append(
            {
                "id": str(time.time_ns()),
                "event": event_type,
                "paperId": paper_id,
                "timestamp": time.time(),
            }
        )


class PaperReaderHandler(SimpleHTTPRequestHandler):
    server_version = "PaperReaderAIBranch/1.0"

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        request_path = parsed.path
        if request_path in {"/", ""}:
            request_path = "/web/index.html"
        if request_path == "/web":
            request_path = "/web/index.html"
        resolved = (ROOT_DIR / request_path.lstrip("/")).resolve()
        if ROOT_DIR in resolved.parents or resolved == ROOT_DIR:
            return str(resolved)
        return str(WEB_DIR / "index.html")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/papers":
            self.respond_json({"papers": present_papers(load_papers())})
            return
        if parsed.path == "/api/events":
            self.handle_sse()
            return
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/papers":
            self.handle_paper_upsert()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown API endpoint")

    def handle_sse(self) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.wfile.write(b"retry: 3000\n\n")
        self.wfile.flush()
        last_id = ""
        try:
            while True:
                event = None
                with EVENTS_LOCK:
                    if EVENTS and EVENTS[-1]["id"] != last_id:
                        event = EVENTS[-1]
                        last_id = event["id"]
                if event:
                    payload = json.dumps(event, ensure_ascii=False)
                    self.wfile.write(f"event: {event['event']}\n".encode("utf-8"))
                    self.wfile.write(f"id: {event['id']}\n".encode("utf-8"))
                    self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                    self.wfile.flush()
                else:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                time.sleep(2)
        except (BrokenPipeError, ConnectionResetError):
            return

    def handle_paper_upsert(self) -> None:
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            },
        )

        original_upload = form["originalFile"] if "originalFile" in form else None
        translation_upload = form["translationFile"] if "translationFile" in form else None
        notes_upload = form["notesFile"] if "notesFile" in form else None
        original_filename = original_upload.filename or "" if isinstance(original_upload, cgi.FieldStorage) else ""

        title = clean_text(form.getfirst("title") or "")
        guessed_title, guessed_year = derive_title_year_from_filename(original_filename) if original_filename else ("", None)
        if not title and guessed_title and guessed_title != "Untitled Paper":
            title = guessed_title
        if not title and original_filename:
            title = Path(original_filename).stem
        if not title:
            self.respond_json({"error": "请至少填写标题，或上传原文 PDF 先创建草稿。"}, status=HTTPStatus.BAD_REQUEST)
            return

        papers = load_papers()
        paper_id = clean_text(form.getfirst("paperId") or "")
        year_text = clean_text(form.getfirst("year") or "")
        year = int(year_text) if year_text.isdigit() else guessed_year or time.localtime().tm_year
        if not paper_id:
            paper_id = f"{year}-{slugify(title)[:60]}"
        existing = next((paper for paper in papers if paper.get("id") == paper_id), None)

        category = clean_text(form.getfirst("category") or "") or (existing.get("category") if existing else "") or "未分类"
        topic_key = slugify(category)
        paper_dir = PAPERS_DIR / topic_key / paper_id
        original_dir = paper_dir / "original"
        translation_dir = paper_dir / "translation"
        notes_dir = paper_dir / "notes"

        original_name = persist_upload(original_upload, original_dir, f"{paper_id}.pdf") if isinstance(original_upload, cgi.FieldStorage) else None
        translation_name = persist_upload(translation_upload, translation_dir, "zh-CN.md") if isinstance(translation_upload, cgi.FieldStorage) else None
        notes_name = persist_upload(notes_upload, notes_dir, "reading-note.md") if isinstance(notes_upload, cgi.FieldStorage) else None

        translation_path = translation_dir / (translation_name or "zh-CN.md")
        notes_path = notes_dir / (notes_name or "reading-note.md")
        ensure_text_file(translation_path, form.getfirst("translationText") or "", default_translation(title))
        ensure_text_file(notes_path, form.getfirst("notesText") or "", default_notes(title))

        original_rel = f"/papers/{topic_key}/{paper_id}/original/{original_name}" if original_name else (existing.get("original") if existing else None)
        translation_rel = f"/papers/{topic_key}/{paper_id}/translation/{translation_path.name}"
        notes_rel = f"/papers/{topic_key}/{paper_id}/notes/{notes_path.name}"

        takeaways = [clean_text(item) for item in (form.getfirst("takeaways") or "").splitlines() if clean_text(item)]
        if not takeaways and existing:
            takeaways = existing.get("takeaways", [])

        def field_value(name: str, fallback: str = "") -> str:
            value = clean_text(form.getfirst(name) or "")
            if value:
                return value
            return clean_text((existing or {}).get(name, fallback))

        paper_record = {
            "id": paper_id,
            "title": title,
            "titleZh": field_value("titleZh") or title,
            "authors": field_value("authors"),
            "venue": field_value("venue"),
            "doi": field_value("doi"),
            "year": year,
            "category": category,
            "topicKey": topic_key,
            "summary": field_value("summary", default_summary(title)),
            "takeaways": takeaways,
            "citation": field_value("citation"),
            "focus": field_value("focus"),
            "aiStatus": field_value("aiStatus", "待AI整理"),
            "readingStatus": field_value("readingStatus", "待读"),
            "original": original_rel,
            "originalUrl": field_value("originalUrl"),
            "translation": translation_rel,
            "notes": notes_rel,
        }

        if existing:
            existing.update(paper_record)
        else:
            papers.append(paper_record)

        papers.sort(key=lambda item: (str(item.get("year", "")), item.get("title", "")), reverse=True)
        save_papers(papers)
        push_event("paper-updated", paper_id)
        self.respond_json({"ok": True, "paperId": paper_id})


def main() -> None:
    port = int(os.environ.get("PAPER_READER_PORT", "8877"))
    server = ThreadingHTTPServer(("127.0.0.1", port), PaperReaderHandler)
    print(f"Paper Reader AI Branch running on http://127.0.0.1:{port}/web/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
