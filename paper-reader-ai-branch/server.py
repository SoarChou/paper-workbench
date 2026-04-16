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
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import cgi


ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
PAPERS_JSON = DATA_DIR / "papers.json"
SUMMARY_CSV = ROOT_DIR / "summaries" / "papers-overview.csv"
PAPERS_DIR = ROOT_DIR / "papers"
TEMPLATES_DIR = ROOT_DIR / "templates"
WEB_DIR = ROOT_DIR / "web"

EVENTS_LOCK = threading.Lock()
EVENTS: deque[dict] = deque(maxlen=100)
PAPERS_LOCK = threading.Lock()
STOP_WORDS = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "via", "with"}
AI_STATUS_OPTIONS = ["待整理", "待元数据", "待摘要", "待翻译", "待笔记", "待校对", "已完成"]
READING_STATUS_OPTIONS = ["待读", "在读", "已读"]
AI_STATUS_LEGACY_MAP = {
    "待AI整理": "待整理",
    "待翻译": "待翻译",
    "待笔记": "待笔记",
    "已完成": "已完成",
}
PENDING_MARKERS = ("待 AI 生成", "待AI生成", "待生成标准摘要", "待我为你补全")


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


def normalize_ai_status(value: str, fallback: str = "待整理") -> str:
    cleaned = clean_text(value)
    if not cleaned:
        return fallback
    normalized = AI_STATUS_LEGACY_MAP.get(cleaned, cleaned)
    if normalized in AI_STATUS_OPTIONS:
        return normalized
    return fallback


def normalize_reading_status(value: str, fallback: str = "待读") -> str:
    cleaned = clean_text(value)
    if cleaned in READING_STATUS_OPTIONS:
        return cleaned
    return fallback


def normalize_bool(value, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    cleaned = clean_text(str(value))
    if not cleaned:
        return fallback
    lowered = cleaned.lower()
    if lowered in {"1", "true", "yes", "y", "on", "star", "starred", "收藏", "已收藏", "是"}:
        return True
    if lowered in {"0", "false", "no", "n", "off", "unstar", "取消收藏", "否"}:
        return False
    return fallback


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_published_at(value: str, year_value: int | str | None) -> str:
    cleaned = clean_text(value)
    if re.fullmatch(r"\d{4}", cleaned):
        return f"{cleaned}-01-01"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cleaned):
        return cleaned
    if cleaned:
        try:
            normalized = cleaned.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(normalized)
            return parsed.date().isoformat()
        except ValueError:
            pass
    if isinstance(year_value, int) and year_value > 0:
        return f"{year_value}-01-01"
    if isinstance(year_value, str) and year_value.isdigit():
        return f"{year_value}-01-01"
    return ""


def normalize_datetime(value: str) -> str:
    cleaned = clean_text(value)
    if not cleaned:
        return ""
    try:
        normalized = cleaned.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except ValueError:
        return ""


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


def resolve_relative_file(path_value: str) -> Path | None:
    relative = clean_text(path_value).lstrip("/")
    if not relative:
        return None
    target = (ROOT_DIR / relative).resolve()
    if ROOT_DIR not in target.parents:
        return None
    return target


def to_root_relative_path(path: Path) -> str:
    resolved = path.resolve()
    if ROOT_DIR not in resolved.parents:
        return ""
    relative = resolved.relative_to(ROOT_DIR).as_posix()
    return f"/{relative}"


def clip_text(value: str, limit: int = 200) -> str:
    text = clean_text(value)
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def render_template(template_name: str, fallback: str, **variables: str) -> str:
    template_path = TEMPLATES_DIR / template_name
    template = template_path.read_text(encoding="utf-8") if template_path.exists() else fallback
    for key, value in variables.items():
        template = template.replace(f"{{{{ {key} }}}}", value)
    return template if template.endswith("\n") else template + "\n"


def default_summary(title: str) -> str:
    return (
        f"《{title}》待生成详细摘要：请覆盖研究问题与背景、方法与证据、主要结论与适用边界，"
        "并明确至少一条局限或成立前提。"
    )


def default_translation(title: str) -> str:
    return render_template(
        "translation-template.md",
        (
            "# {{ title }}\n\n"
            "## 翻译说明\n\n"
            "- 目标：提供可直接阅读的结构化中文译稿。\n"
            "- 覆盖：摘要 + 引言要点 + 方法要点 + 实验与结果 + 讨论/结论 + 术语对照。\n\n"
            "## 摘要全译\n\n"
            "- 待 AI 生成（尽量保持原意，不省略关键限定条件）。\n\n"
            "## 正文翻译（结构化）\n\n"
            "### 1. 引言与问题定义\n\n"
            "- 待 AI 生成。\n\n"
            "### 2. 方法与模型/框架\n\n"
            "- 待 AI 生成。\n\n"
            "### 3. 实验设置\n\n"
            "- 待 AI 生成。\n\n"
            "### 4. 主要结果与分析\n\n"
            "- 待 AI 生成。\n\n"
            "### 5. 局限、威胁与结论\n\n"
            "- 待 AI 生成。\n\n"
            "## 术语对照（中英）\n\n"
            "- 待 AI 生成。\n\n"
            "## 未覆盖内容（如有）\n\n"
            "- 待 AI 生成。\n"
        ),
        title=title,
    )


def default_notes(title: str) -> str:
    return render_template(
        "notes-template.md",
        (
            "# 阅读笔记：{{ title }}\n\n"
            "## 一句话总结\n\n"
            "- 待 AI 生成。\n\n"
            "## 三句话讲清楚（面向复述）\n\n"
            "- 这篇论文要解决什么：待 AI 生成。\n"
            "- 它怎么解决：待 AI 生成。\n"
            "- 它真的证明了什么：待 AI 生成。\n\n"
            "## 核心问题与假设\n\n"
            "- 待 AI 生成。\n\n"
            "## 方法拆解\n\n"
            "- 待 AI 生成。\n\n"
            "## 实验与结果\n\n"
            "- 待 AI 生成。\n\n"
            "## 局限与疑问\n\n"
            "- 待 AI 生成。\n\n"
            "## 可复现线索\n\n"
            "- 待 AI 生成。\n"
            "- 数据与代码可得性：待 AI 生成。\n\n"
            "## 下一步阅读\n\n"
            "- 待 AI 生成。\n"
        ),
        title=title,
    )


def default_qa_log(title: str) -> str:
    return (
        f"# 论文问答记录：{title}\n\n"
        "> 自动保存用户与 Codex 围绕该论文的问答；新记录会同步沉淀到阅读笔记。\n\n"
    )


def append_qa_log(log_path: Path, title: str, question: str, answer: str, asked_at: str) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if not log_path.exists():
        log_path.write_text(default_qa_log(title), encoding="utf-8")
    block = (
        f"## {asked_at}\n\n"
        f"- 问：{clip_text(question, 280)}\n"
        f"- 答：{clip_text(answer, 560)}\n\n"
    )
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(block)


def append_qa_to_notes(notes_path: Path, title: str, question: str, answer: str, asked_at: str) -> bool:
    ensure_text_file(notes_path, "", default_notes(title))
    notes_text = notes_path.read_text(encoding="utf-8")
    question_line = f"问：{clip_text(question, 160)}"
    answer_line = f"答：{clip_text(answer, 260)}"
    if question_line in notes_text and answer_line in notes_text:
        return False

    section_title = "## 对话沉淀（自动更新）"
    addition = f"- [{asked_at}] {question_line}\n  - {answer_line}\n"
    if section_title not in notes_text:
        if not notes_text.endswith("\n"):
            notes_text += "\n"
        notes_text += f"\n{section_title}\n\n{addition}"
    else:
        notes_text += f"{addition if notes_text.endswith(chr(10)) else chr(10) + addition}"
    notes_path.write_text(notes_text, encoding="utf-8")
    return True


def resolve_paper_markdown_path(paper: dict, paper_id: str, kind: str) -> tuple[Path, str]:
    topic_key = slugify(clean_text(paper.get("topicKey", "")) or clean_text(paper.get("category", "")) or "未分类")
    paper_title = clean_text(paper.get("titleZh", "")) or clean_text(paper.get("title", "")) or "未命名论文"
    if kind == "notes":
        record_key = "notes"
        fallback_path = PAPERS_DIR / topic_key / paper_id / "notes" / "reading-note.md"
        default_content = default_notes(paper_title)
    else:
        record_key = "translation"
        fallback_path = PAPERS_DIR / topic_key / paper_id / "translation" / "zh-CN.md"
        default_content = default_translation(paper_title)

    relative_path = clean_text(paper.get(record_key, ""))
    resolved = resolve_relative_file(relative_path)
    if not resolved:
        resolved = fallback_path
        paper[record_key] = to_root_relative_path(resolved)

    ensure_text_file(resolved, "", default_content)
    return resolved, paper_title


def read_relative_text(path_value: str) -> str:
    target = resolve_relative_file(path_value)
    if not target or not target.is_file():
        return ""
    try:
        return target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def looks_generated(text: str) -> bool:
    cleaned = clean_text(text)
    if not cleaned:
        return False
    if any(marker in cleaned for marker in PENDING_MARKERS):
        return False
    return len(cleaned) >= 24


def asset_ready(relative_path: str, *, check_text: bool = False) -> bool:
    relative = clean_text(relative_path).lstrip("/")
    if not relative:
        return False
    target = (ROOT_DIR / relative).resolve()
    if ROOT_DIR not in target.parents or not target.exists():
        return False
    if not check_text:
        return True
    if target.suffix.lower() not in {".md", ".txt"}:
        return True
    return looks_generated(read_relative_text(relative_path))


def summarize_missing_metadata(record: dict) -> list[str]:
    missing = []
    if not clean_text(record.get("authors", "")):
        missing.append("作者")
    if not clean_text(record.get("venue", "")):
        missing.append("会议/期刊")
    if not record.get("year"):
        missing.append("年份")
    if not clean_text(record.get("doi", "")) and not clean_text(record.get("originalUrl", "")) and not clean_text(record.get("original", "")):
        missing.append("DOI/原文链接")
    return missing


def recommend_ai_status(record: dict) -> tuple[str, str]:
    missing_metadata = summarize_missing_metadata(record)
    if missing_metadata:
        preview = "、".join(missing_metadata[:3])
        suffix = "等元数据" if len(missing_metadata) > 3 else ""
        return ("待元数据", f"补全 {preview}{suffix}".strip())

    summary_ready = looks_generated(record.get("summary", ""))
    takeaways_ready = len([item for item in record.get("takeaways", []) if clean_text(item)]) >= 2
    focus_ready = bool(clean_text(record.get("focus", "")))
    if not (summary_ready and takeaways_ready and focus_ready):
        return ("待摘要", "生成标准摘要、关键信息和研究重点")

    if not asset_ready(record.get("translation", ""), check_text=True):
        return ("待翻译", "生成中文翻译稿")

    if not asset_ready(record.get("notes", ""), check_text=True):
        return ("待笔记", "生成结构化阅读笔记")

    if not clean_text(record.get("citation", "")) or not clean_text(record.get("titleZh", "")):
        return ("待校对", "校对中文标题、引用和最终表述")

    return ("已完成", "内容已齐全，可直接阅读与管理")


def normalize_paper_record(record: dict) -> dict:
    normalized = dict(record)
    year = normalized.get("year", "")
    normalized["publishedAt"] = normalize_published_at(normalized.get("publishedAt", ""), year)
    normalized["importedAt"] = normalize_datetime(normalized.get("importedAt", ""))
    normalized["lastOpenedAt"] = normalize_datetime(normalized.get("lastOpenedAt", ""))
    normalized["readingStatus"] = normalize_reading_status(normalized.get("readingStatus", "待读"))
    normalized["starred"] = normalize_bool(normalized.get("starred", False), False)
    try:
        normalized["qaCount"] = max(0, int(normalized.get("qaCount", 0) or 0))
    except (TypeError, ValueError):
        normalized["qaCount"] = 0
    normalized["conversationLog"] = clean_text(normalized.get("conversationLog", ""))
    normalized["notesEditedAt"] = normalize_datetime(normalized.get("notesEditedAt", ""))
    normalized["translationEditedAt"] = normalize_datetime(normalized.get("translationEditedAt", ""))
    return normalized


def load_papers() -> list[dict]:
    if not PAPERS_JSON.exists():
        return []
    with PAPERS_JSON.open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    return [normalize_paper_record(item) for item in loaded]


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
                "ai_recommended_status",
                "ai_next_action",
                "reading_status",
                "published_at",
                "imported_at",
                "last_opened_at",
                "original",
                "translation",
                "notes",
                "starred",
                "qa_count",
                "conversation_log",
            ]
        )
        for paper in papers:
            display = present_paper(paper)
            writer.writerow(
                [
                    display.get("id", ""),
                    display.get("category", ""),
                    display.get("year", ""),
                    display.get("title", ""),
                    display.get("authors", ""),
                    display.get("venue", ""),
                    display.get("doi", ""),
                    display.get("aiStatus", "待整理"),
                    display.get("aiRecommendedStatus", "待整理"),
                    display.get("aiNextAction", ""),
                    display.get("readingStatus", "待读"),
                    display.get("publishedAt", ""),
                    display.get("importedAt", ""),
                    display.get("lastOpenedAt", ""),
                    display.get("original", "") or display.get("originalUrl", ""),
                    display.get("translation", ""),
                    display.get("notes", ""),
                    "1" if display.get("starred") else "0",
                    display.get("qaCount", 0),
                    display.get("conversationLog", ""),
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
    display["takeaways"] = [clean_text(item) for item in display.get("takeaways", []) if clean_text(item)]
    recommended_status, next_action = recommend_ai_status(display)
    current_status = normalize_ai_status(display.get("aiStatus", ""), "")
    if not current_status or current_status == "待整理":
        current_status = recommended_status
    elif current_status == "已完成" and recommended_status != "已完成":
        current_status = recommended_status
    display["aiStatus"] = current_status or "待整理"
    display["aiRecommendedStatus"] = recommended_status
    display["aiNextAction"] = next_action
    display["readingStatus"] = normalize_reading_status(display.get("readingStatus", "待读"))
    display["starred"] = normalize_bool(display.get("starred", False), False)
    try:
        display["qaCount"] = max(0, int(display.get("qaCount", 0) or 0))
    except (TypeError, ValueError):
        display["qaCount"] = 0
    display["conversationLog"] = clean_text(display.get("conversationLog", ""))
    display["notesEditedAt"] = normalize_datetime(display.get("notesEditedAt", ""))
    display["translationEditedAt"] = normalize_datetime(display.get("translationEditedAt", ""))
    display["publishedAt"] = normalize_published_at(display.get("publishedAt", ""), display.get("year"))
    display["importedAt"] = normalize_datetime(display.get("importedAt", ""))
    display["lastOpenedAt"] = normalize_datetime(display.get("lastOpenedAt", ""))
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
        request_path = unquote(parsed.path)
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
        if parsed.path == "/api/papers/open":
            self.handle_paper_open()
            return
        if parsed.path == "/api/papers/delete":
            self.handle_papers_delete()
            return
        if parsed.path == "/api/papers/patch":
            self.handle_paper_patch()
            return
        if parsed.path == "/api/papers/qa":
            self.handle_paper_qa()
            return
        if parsed.path == "/api/papers/content":
            self.handle_paper_content()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown API endpoint")

    def read_json_body(self) -> dict:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length)
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}

    def handle_paper_open(self) -> None:
        payload = self.read_json_body()
        paper_id = clean_text(payload.get("paperId", ""))
        if not paper_id:
            self.respond_json({"error": "缺少 paperId"}, status=HTTPStatus.BAD_REQUEST)
            return

        with PAPERS_LOCK:
            papers = load_papers()
            paper = next((item for item in papers if item.get("id") == paper_id), None)
            if not paper:
                self.respond_json({"error": "论文不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            paper["lastOpenedAt"] = now_iso()
            if not clean_text(paper.get("importedAt", "")):
                paper["importedAt"] = now_iso()
            save_papers(papers)

        push_event("paper-updated", paper_id)
        self.respond_json({"ok": True, "paperId": paper_id})

    def handle_papers_delete(self) -> None:
        payload = self.read_json_body()
        requested_ids = payload.get("paperIds", [])
        paper_ids = [clean_text(item) for item in requested_ids if clean_text(item)]
        if not paper_ids:
            self.respond_json({"error": "缺少 paperIds"}, status=HTTPStatus.BAD_REQUEST)
            return

        with PAPERS_LOCK:
            papers = load_papers()
            removed_ids: list[str] = []
            kept: list[dict] = []
            removed_records: list[dict] = []
            for paper in papers:
                if paper.get("id") in paper_ids:
                    removed_ids.append(paper["id"])
                    removed_records.append(paper)
                else:
                    kept.append(paper)
            if not removed_ids:
                self.respond_json({"error": "未找到可删除条目"}, status=HTTPStatus.NOT_FOUND)
                return

            for paper in removed_records:
                topic_key = slugify(clean_text(paper.get("topicKey", "")) or clean_text(paper.get("category", "")) or "未分类")
                target_dir = (PAPERS_DIR / topic_key / paper["id"]).resolve()
                if PAPERS_DIR in target_dir.parents and target_dir.exists():
                    shutil.rmtree(target_dir, ignore_errors=True)

            save_papers(kept)

        for removed_id in removed_ids:
            push_event("paper-updated", removed_id)
        self.respond_json({"ok": True, "deleted": removed_ids})

    def handle_paper_patch(self) -> None:
        payload = self.read_json_body()
        paper_id = clean_text(payload.get("paperId", ""))
        patch = payload.get("patch", {})
        if not paper_id:
            self.respond_json({"error": "缺少 paperId"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not isinstance(patch, dict):
            self.respond_json({"error": "patch 格式错误"}, status=HTTPStatus.BAD_REQUEST)
            return

        with PAPERS_LOCK:
            papers = load_papers()
            paper = next((item for item in papers if item.get("id") == paper_id), None)
            if not paper:
                self.respond_json({"error": "论文不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            if "titleZh" in patch:
                paper["titleZh"] = clean_text(patch.get("titleZh", "")) or clean_text(paper.get("titleZh", "")) or clean_text(paper.get("title", ""))
            if "category" in patch:
                paper["category"] = clean_text(patch.get("category", "")) or clean_text(paper.get("category", "")) or "未分类"
            if "year" in patch:
                year_text = clean_text(str(patch.get("year", "")))
                paper["year"] = int(year_text) if year_text.isdigit() else paper.get("year", "")
            if "publishedAt" in patch:
                paper["publishedAt"] = normalize_published_at(patch.get("publishedAt", ""), paper.get("year"))
            if "aiStatus" in patch:
                paper["aiStatus"] = normalize_ai_status(patch.get("aiStatus", ""), paper.get("aiStatus", "待整理"))
            if "readingStatus" in patch:
                paper["readingStatus"] = normalize_reading_status(patch.get("readingStatus", ""), paper.get("readingStatus", "待读"))
            if "starred" in patch:
                paper["starred"] = normalize_bool(patch.get("starred"), normalize_bool(paper.get("starred", False), False))
            if "venue" in patch:
                paper["venue"] = clean_text(patch.get("venue", "")) or clean_text(paper.get("venue", ""))
            if "doi" in patch:
                paper["doi"] = clean_text(patch.get("doi", "")) or clean_text(paper.get("doi", ""))
            if not clean_text(paper.get("importedAt", "")):
                paper["importedAt"] = now_iso()

            save_papers(papers)
            display = present_paper(paper)

        push_event("paper-updated", paper_id)
        self.respond_json({"ok": True, "paper": display})

    def handle_paper_qa(self) -> None:
        payload = self.read_json_body()
        paper_id = clean_text(payload.get("paperId", ""))
        if not paper_id:
            self.respond_json({"error": "缺少 paperId"}, status=HTTPStatus.BAD_REQUEST)
            return

        qa_items: list[tuple[str, str]] = []
        raw_items = payload.get("qaItems")
        if isinstance(raw_items, list):
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                question = clean_text(item.get("question", ""))
                answer = clean_text(item.get("answer", ""))
                if question and answer:
                    qa_items.append((question, answer))
        else:
            question = clean_text(payload.get("question", ""))
            answer = clean_text(payload.get("answer", ""))
            if question and answer:
                qa_items.append((question, answer))

        if not qa_items:
            self.respond_json({"error": "缺少有效问答内容"}, status=HTTPStatus.BAD_REQUEST)
            return

        appended_to_notes = 0
        appended_to_log = 0
        with PAPERS_LOCK:
            papers = load_papers()
            paper = next((item for item in papers if item.get("id") == paper_id), None)
            if not paper:
                self.respond_json({"error": "论文不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            topic_key = slugify(clean_text(paper.get("topicKey", "")) or clean_text(paper.get("category", "")) or "未分类")
            notes_relative = clean_text(paper.get("notes", ""))
            notes_path = resolve_relative_file(notes_relative)
            if not notes_path:
                notes_path = PAPERS_DIR / topic_key / paper_id / "notes" / "reading-note.md"
                paper["notes"] = to_root_relative_path(notes_path)

            paper_title = clean_text(paper.get("titleZh", "")) or clean_text(paper.get("title", "")) or "未命名论文"
            ensure_text_file(notes_path, "", default_notes(paper_title))

            conversation_relative = clean_text(paper.get("conversationLog", ""))
            conversation_path = resolve_relative_file(conversation_relative)
            if not conversation_path:
                conversation_path = notes_path.parent / "qa-log.md"
                paper["conversationLog"] = to_root_relative_path(conversation_path)

            for question, answer in qa_items:
                asked_at = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")
                append_qa_log(conversation_path, paper_title, question, answer, asked_at)
                appended_to_log += 1
                if append_qa_to_notes(notes_path, paper_title, question, answer, asked_at):
                    appended_to_notes += 1

            try:
                base_qa_count = max(0, int(paper.get("qaCount", 0) or 0))
            except (TypeError, ValueError):
                base_qa_count = 0
            paper["qaCount"] = base_qa_count + appended_to_log
            if not clean_text(paper.get("importedAt", "")):
                paper["importedAt"] = now_iso()
            save_papers(papers)
            display = present_paper(paper)

        push_event("paper-updated", paper_id)
        self.respond_json(
            {
                "ok": True,
                "paper": display,
                "appended": appended_to_log,
                "notesUpdated": appended_to_notes,
            }
        )

    def handle_paper_content(self) -> None:
        payload = self.read_json_body()
        paper_id = clean_text(payload.get("paperId", ""))
        kind = clean_text(payload.get("kind", "")).lower()
        if not paper_id:
            self.respond_json({"error": "缺少 paperId"}, status=HTTPStatus.BAD_REQUEST)
            return
        if kind not in {"notes", "translation"}:
            self.respond_json({"error": "kind 仅支持 notes 或 translation"}, status=HTTPStatus.BAD_REQUEST)
            return

        raw_content = payload.get("content", "")
        if raw_content is None:
            raw_content = ""
        if not isinstance(raw_content, str):
            raw_content = str(raw_content)
        content_text = raw_content.replace("\r\n", "\n").replace("\r", "\n")
        if content_text and not content_text.endswith("\n"):
            content_text += "\n"

        with PAPERS_LOCK:
            papers = load_papers()
            paper = next((item for item in papers if item.get("id") == paper_id), None)
            if not paper:
                self.respond_json({"error": "论文不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            target_path, _ = resolve_paper_markdown_path(paper, paper_id, kind)
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(content_text, encoding="utf-8")
            edited_at = now_iso()
            if kind == "notes":
                paper["notesEditedAt"] = edited_at
                if normalize_ai_status(paper.get("aiStatus", ""), "待整理") == "待笔记":
                    paper["aiStatus"] = "待校对"
            else:
                paper["translationEditedAt"] = edited_at
                if normalize_ai_status(paper.get("aiStatus", ""), "待整理") == "待翻译":
                    paper["aiStatus"] = "待笔记"

            if not clean_text(paper.get("importedAt", "")):
                paper["importedAt"] = now_iso()

            save_papers(papers)
            display = present_paper(paper)

        push_event("paper-updated", paper_id)
        self.respond_json({"ok": True, "paper": display, "kind": kind})

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

        with PAPERS_LOCK:
            papers = load_papers()
            paper_id = clean_text(form.getfirst("paperId") or "")
            year_text = clean_text(form.getfirst("year") or "")
            existing = next((paper for paper in papers if paper.get("id") == paper_id), None)
            existing_year = existing.get("year") if existing else None
            year = int(year_text) if year_text.isdigit() else existing_year or guessed_year or ""
            if not paper_id:
                year_prefix = str(year) if year else "draft"
                paper_id = f"{year_prefix}-{slugify(title)[:60]}"
                existing = next((paper for paper in papers if paper.get("id") == paper_id), None)
            imported_at = normalize_datetime((existing or {}).get("importedAt", "")) or now_iso()
            published_at_input = clean_text(form.getfirst("publishedAt") or "")
            existing_published_at = (existing or {}).get("publishedAt", "")
            published_at = normalize_published_at(published_at_input, year) or normalize_published_at(existing_published_at, year)
            last_opened_at = normalize_datetime((existing or {}).get("lastOpenedAt", ""))

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
            conversation_rel = clean_text((existing or {}).get("conversationLog", "")) or f"/papers/{topic_key}/{paper_id}/notes/qa-log.md"
            try:
                existing_qa_count = max(0, int((existing or {}).get("qaCount", 0) or 0))
            except (TypeError, ValueError):
                existing_qa_count = 0

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
                "readingStatus": normalize_reading_status(field_value("readingStatus", "待读")),
                "original": original_rel,
                "originalUrl": field_value("originalUrl"),
                "translation": translation_rel,
                "notes": notes_rel,
                "conversationLog": conversation_rel,
                "qaCount": existing_qa_count,
                "starred": normalize_bool((existing or {}).get("starred", False), False),
                "importedAt": imported_at,
                "publishedAt": published_at,
                "lastOpenedAt": last_opened_at,
            }
            recommended_status, _ = recommend_ai_status(paper_record)
            requested_status = normalize_ai_status(field_value("aiStatus", ""), "")
            if not requested_status or requested_status == "待整理":
                paper_record["aiStatus"] = recommended_status
            elif requested_status == "已完成" and recommended_status != "已完成":
                paper_record["aiStatus"] = recommended_status
            else:
                paper_record["aiStatus"] = requested_status

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
