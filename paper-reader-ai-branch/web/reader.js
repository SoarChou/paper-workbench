const params = new URLSearchParams(window.location.search);
const paperId = params.get("paperId") || "";
const requestedView = String(params.get("view") || "").trim();
let currentView = ["translation", "notes", "qa"].includes(requestedView) ? requestedView : "translation";
let currentPaper = null;
let localUpdateExpiry = 0;

const LOCAL_EVENT_SUPPRESS_MS = 5000;
const cache = new Map();
const PENDING_PATTERNS = [
  /待\s*ai\s*生成/i,
  /待生成/i,
  /稍后补充/i,
  /占位/i,
  /placeholder/i,
  /tbd|todo/i,
  /暂无(翻译|笔记|内容)/i,
];

const paperTitle = document.querySelector("#paperTitle");
const paperMeta = document.querySelector("#paperMeta");
const originalContainer = document.querySelector("#originalContainer");
const sideContent = document.querySelector("#sideContent");
const openOriginalLink = document.querySelector("#openOriginalLink");
const toggleStarBtn = document.querySelector("#toggleStarBtn");
const qaCountBadge = document.querySelector("#qaCountBadge");
const tabButtons = {
  translation: document.querySelector("#viewTranslationBtn"),
  notes: document.querySelector("#viewNotesBtn"),
  qa: document.querySelector("#viewQaBtn"),
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(pathOrUrl) {
  return encodeURI(String(pathOrUrl || "").trim());
}

function markLocalPaperUpdate() {
  localUpdateExpiry = Date.now() + LOCAL_EVENT_SUPPRESS_MS;
}

function shouldIgnoreLocalUpdateEvent() {
  return localUpdateExpiry > Date.now();
}

function resolveStatusText(view, aiStatus) {
  if (aiStatus === "已完成") {
    return "已完成";
  }
  if (view === "translation") {
    return "正在生成翻译";
  }
  if (view === "notes") {
    return "正在整理笔记";
  }
  return "正在处理中";
}

function looksPendingContent(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return true;
  }
  if (normalized.length < 36 && /待|生成中|稍后|占位|todo|tbd|placeholder/i.test(normalized)) {
    return true;
  }
  return PENDING_PATTERNS.some((pattern) => pattern.test(normalized));
}

function renderPendingBlock(statusText, hintText) {
  return `
    <section class="reader-pending">
      <p class="reader-status status-working"><span class="status-dot"></span>${escapeHtml(statusText)}</p>
      <p class="reader-empty">${escapeHtml(hintText)}</p>
      <div class="reader-skeleton">
        <div class="skeleton-line w-95"></div>
        <div class="skeleton-line w-88"></div>
        <div class="skeleton-line w-84"></div>
        <div class="skeleton-line w-76"></div>
      </div>
    </section>
  `;
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const chunks = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      chunks.push("</ul>");
      inList = false;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      return;
    }

    if (trimmed.startsWith("### ")) {
      closeList();
      chunks.push(`<h4>${escapeHtml(trimmed.slice(4))}</h4>`);
      return;
    }
    if (trimmed.startsWith("## ")) {
      closeList();
      chunks.push(`<h3>${escapeHtml(trimmed.slice(3))}</h3>`);
      return;
    }
    if (trimmed.startsWith("# ")) {
      closeList();
      chunks.push(`<h2>${escapeHtml(trimmed.slice(2))}</h2>`);
      return;
    }
    if (trimmed.startsWith("- ")) {
      if (!inList) {
        chunks.push("<ul>");
        inList = true;
      }
      chunks.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
      return;
    }

    closeList();
    chunks.push(`<p>${escapeHtml(trimmed)}</p>`);
  });

  closeList();
  return chunks.join("") || `<p class="reader-empty">内容为空。</p>`;
}

async function fetchText(path) {
  if (!path) {
    return "";
  }
  if (cache.has(path)) {
    return cache.get(path);
  }
  const response = await fetch(safeUrl(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`读取失败（${response.status}）`);
  }
  const text = await response.text();
  cache.set(path, text);
  return text;
}

function invalidateTextCache(path) {
  if (!path) {
    return;
  }
  cache.delete(path);
}

async function fetchPaperRecord() {
  const response = await fetch("/api/papers", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`接口返回 ${response.status}`);
  }
  const payload = await response.json();
  return (payload.papers || []).find((item) => item.id === paperId) || null;
}

async function patchPaper(patch) {
  const response = await fetch("/api/papers/patch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, patch }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "更新失败");
  }
  markLocalPaperUpdate();
  return payload.paper || null;
}

async function savePaperContent(kind, content) {
  const response = await fetch("/api/papers/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, kind, content }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "保存失败");
  }
  markLocalPaperUpdate();
  return payload.paper || null;
}

async function appendPaperQa(question, answer) {
  const response = await fetch("/api/papers/qa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, question, answer }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "问答保存失败");
  }
  markLocalPaperUpdate();
  return payload;
}

async function markPaperOpened(paperIdValue) {
  if (!paperIdValue) {
    return;
  }
  try {
    await fetch("/api/papers/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId: paperIdValue }),
    });
    markLocalPaperUpdate();
  } catch (_) {
    // ignore
  }
}

function resolvePdfSource(paper) {
  if (paper.original) {
    return { url: paper.original, type: "pdf" };
  }

  const originalUrl = String(paper.originalUrl || "").trim();
  if (!originalUrl) {
    return { url: "", type: "none" };
  }

  if (/\.pdf($|\?)/i.test(originalUrl)) {
    return { url: originalUrl, type: "pdf" };
  }

  const arxivMatch = originalUrl.match(/^https?:\/\/arxiv\.org\/abs\/([^?#]+)/i);
  if (arxivMatch) {
    return { url: `https://arxiv.org/pdf/${arxivMatch[1]}.pdf`, type: "pdf" };
  }

  return { url: originalUrl, type: "external" };
}

function renderOriginal(paper) {
  const source = resolvePdfSource(paper);
  if (!source.url) {
    originalContainer.innerHTML = `<p class="reader-empty">未找到原文 PDF，请在工作台上传原文文件。</p>`;
    openOriginalLink.hidden = true;
    return;
  }

  openOriginalLink.hidden = false;
  openOriginalLink.href = safeUrl(source.url);

  if (source.type === "pdf") {
    originalContainer.innerHTML = `<iframe class="reader-pdf-frame" src="${safeUrl(source.url)}" title="论文原文 PDF"></iframe>`;
    return;
  }

  originalContainer.innerHTML = `
    <div class="reader-callout">
      <p>该原文链接不支持内嵌 PDF 预览，请点击右上角按钮在新窗口打开。</p>
      <p>${escapeHtml(source.url)}</p>
    </div>
  `;
}

function renderTabsState() {
  Object.entries(tabButtons).forEach(([name, button]) => {
    if (!button) {
      return;
    }
    button.classList.toggle("active", currentView === name);
  });
}

function renderHeaderMeta(paper) {
  paperTitle.textContent = paper.titleZh || paper.title || "未命名论文";
  paperMeta.textContent = [paper.title, paper.authors, paper.venue, paper.year].filter(Boolean).join(" · ");

  const starred = Boolean(paper.starred);
  toggleStarBtn.classList.toggle("is-starred", starred);
  toggleStarBtn.setAttribute("aria-pressed", starred ? "true" : "false");
  toggleStarBtn.setAttribute("title", starred ? "取消星标" : "添加星标");
  toggleStarBtn.textContent = starred ? "★ 已星标" : "☆ 星标";

  const qaCount = Math.max(0, Number(paper.qaCount || 0));
  qaCountBadge.hidden = qaCount <= 0;
  qaCountBadge.textContent = `问答 ${qaCount}`;
}

async function loadMarkdownState(path, label, viewName, aiStatus) {
  const pendingStatus = resolveStatusText(viewName, aiStatus);
  if (!path) {
    return { markdown: "", pendingHtml: renderPendingBlock(pendingStatus, `当前${label}暂未生成，完成后会自动更新。`) };
  }
  try {
    const markdown = await fetchText(path);
    if (looksPendingContent(markdown)) {
      return { markdown: "", pendingHtml: renderPendingBlock(pendingStatus, `当前${label}正在生成中，完成后会自动更新。`) };
    }
    return { markdown, pendingHtml: "" };
  } catch (error) {
    return {
      markdown: "",
      pendingHtml: renderPendingBlock(`正在重试加载${label}`, `${label}读取失败：${escapeHtml(error.message || "未知错误")}`),
    };
  }
}

async function renderTranslationSide(paper) {
  sideContent.innerHTML = renderPendingBlock("正在加载翻译", "正在读取翻译内容…");
  const state = await loadMarkdownState(paper.translation, "翻译", "translation", paper.aiStatus);

  const bodyHtml = state.markdown
    ? `<article class="reader-markdown">${markdownToHtml(state.markdown)}</article>`
    : state.pendingHtml;

  sideContent.innerHTML = `
    <section class="reader-doc-panel">
      <div class="reader-doc-body">${bodyHtml}</div>
    </section>
  `;
}

async function renderNotesSide(paper) {
  sideContent.innerHTML = renderPendingBlock("正在加载笔记", "正在读取笔记内容…");
  const state = await loadMarkdownState(paper.notes, "笔记", "notes", paper.aiStatus);
  let currentNotesText = state.markdown || "";
  const viewHtml = state.markdown
    ? `<article class="reader-markdown">${markdownToHtml(state.markdown)}</article>`
    : state.pendingHtml;

  sideContent.innerHTML = `
    <section class="reader-doc-panel">
      <div class="reader-content-tools">
        <button id="editNotesBtn" class="secondary-btn" type="button">编辑笔记</button>
        <p id="notesEditFeedback" class="reader-tool-feedback"></p>
      </div>
      <div id="notesBody" class="reader-doc-body">${viewHtml}</div>
    </section>
  `;

  const notesBody = sideContent.querySelector("#notesBody");
  const editBtn = sideContent.querySelector("#editNotesBtn");
  const feedback = sideContent.querySelector("#notesEditFeedback");

  const renderViewMode = (markdownText) => {
    notesBody.innerHTML = markdownText
      ? `<article class="reader-markdown">${markdownToHtml(markdownText)}</article>`
      : `<p class="reader-empty">笔记为空，点击上方“编辑笔记”开始填写。</p>`;
  };

  const renderEditMode = (markdownText) => {
    notesBody.innerHTML = `
      <form id="notesEditForm" class="notes-edit-form">
        <label class="control">
          <span>笔记内容（Markdown）</span>
          <textarea id="notesEditTextarea">${escapeHtml(markdownText)}</textarea>
        </label>
        <div class="notes-edit-actions">
          <button id="notesCancelBtn" class="secondary-btn" type="button">取消</button>
          <button id="notesSaveBtn" class="primary-btn" type="submit">保存笔记</button>
        </div>
      </form>
    `;

    const form = notesBody.querySelector("#notesEditForm");
    const textarea = notesBody.querySelector("#notesEditTextarea");
    const cancelBtn = notesBody.querySelector("#notesCancelBtn");
    const saveBtn = notesBody.querySelector("#notesSaveBtn");

    cancelBtn?.addEventListener("click", () => {
      renderViewMode(markdownText);
      if (feedback) {
        feedback.textContent = "";
        feedback.className = "reader-tool-feedback";
      }
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const nextText = String(textarea?.value || "");
      if (saveBtn) {
        saveBtn.disabled = true;
      }
      if (feedback) {
        feedback.textContent = "正在保存笔记…";
        feedback.className = "reader-tool-feedback";
      }
      try {
        const updated = await savePaperContent("notes", nextText);
        if (updated) {
          currentPaper = updated;
        }
        currentNotesText = nextText;
        invalidateTextCache(currentPaper?.notes);
        renderHeaderMeta(currentPaper);
        renderViewMode(currentNotesText);
        if (feedback) {
          feedback.textContent = "笔记已保存。";
          feedback.className = "reader-tool-feedback success";
        }
      } catch (error) {
        if (feedback) {
          feedback.textContent = error.message || "保存失败，请稍后重试。";
          feedback.className = "reader-tool-feedback error";
        }
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
        }
      }
    });
  };

  editBtn?.addEventListener("click", () => {
    renderEditMode(currentNotesText);
  });
}

async function renderQaSide(paper) {
  const logPath = paper.conversationLog || "";
  let logHtml = `<p class="reader-empty">还没有问答记录。你可以在下方录入问题和回答，系统会自动沉淀到笔记。</p>`;

  if (logPath) {
    try {
      const markdown = await fetchText(logPath);
      logHtml = markdown.trim()
        ? `<article class="reader-markdown qa-log-markdown">${markdownToHtml(markdown)}</article>`
        : logHtml;
    } catch (_) {
      logHtml = `<p class="reader-empty">问答记录暂不可读，稍后会自动重试。</p>`;
    }
  }

  sideContent.innerHTML = `
    <section class="qa-panel">
      <section class="qa-auto-tip">
        <p>这里的问答会由你和 Codex 的论文对话自动沉淀；下方仅用于补录历史记录。</p>
      </section>
      <details class="qa-manual-details">
        <summary>手动补录（可选）</summary>
        <form id="qaForm" class="qa-form">
          <label class="control qa-field">
            <span>问题</span>
            <textarea id="qaQuestionInput" placeholder="例：这篇论文的核心创新是什么？" required></textarea>
          </label>
          <label class="control qa-field">
            <span>回答</span>
            <textarea id="qaAnswerInput" placeholder="补录你与 Codex 的关键回答。" required></textarea>
          </label>
          <div class="qa-form-actions">
            <button id="qaSubmitBtn" class="primary-btn" type="submit">保存补录</button>
            <p id="qaFormFeedback" class="qa-feedback"></p>
          </div>
        </form>
      </details>
      <section class="qa-log-wrap">
        <h3>历史问答</h3>
        <div class="qa-log-body">${logHtml}</div>
      </section>
    </section>
  `;

  const form = sideContent.querySelector("#qaForm");
  const questionInput = sideContent.querySelector("#qaQuestionInput");
  const answerInput = sideContent.querySelector("#qaAnswerInput");
  const submitBtn = sideContent.querySelector("#qaSubmitBtn");
  const feedback = sideContent.querySelector("#qaFormFeedback");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = String(questionInput?.value || "").trim();
    const answer = String(answerInput?.value || "").trim();
    if (!question || !answer) {
      if (feedback) {
        feedback.textContent = "请同时填写问题和回答。";
        feedback.className = "qa-feedback error";
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
    }
    if (feedback) {
      feedback.textContent = "正在保存问答…";
      feedback.className = "qa-feedback";
    }

    try {
      const payload = await appendPaperQa(question, answer);
      if (payload.paper) {
        currentPaper = payload.paper;
      }
      invalidateTextCache(currentPaper?.conversationLog);
      invalidateTextCache(currentPaper?.notes);
      if (questionInput) {
        questionInput.value = "";
      }
      if (answerInput) {
        answerInput.value = "";
      }
      if (feedback) {
        feedback.textContent = "已保存，阅读笔记已自动更新。";
        feedback.className = "qa-feedback success";
      }
      renderHeaderMeta(currentPaper);
      await renderQaSide(currentPaper);
    } catch (error) {
      if (feedback) {
        feedback.textContent = error.message || "保存失败，请稍后重试。";
        feedback.className = "qa-feedback error";
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  });
}

async function renderSideContent(paper) {
  if (!["translation", "notes", "qa"].includes(currentView)) {
    currentView = "translation";
  }
  renderTabsState();

  if (currentView === "qa") {
    await renderQaSide(paper);
    return;
  }

  if (currentView === "notes") {
    await renderNotesSide(paper);
    return;
  }
  await renderTranslationSide(paper);
}

async function refreshPaper({ reloadOriginal = false } = {}) {
  const nextPaper = await fetchPaperRecord();
  if (!nextPaper) {
    paperTitle.textContent = "论文不存在";
    paperMeta.textContent = "该论文可能已删除或 ID 已变更。";
    originalContainer.innerHTML = `<p class="reader-empty">未找到对应论文条目。</p>`;
    sideContent.innerHTML = `<p class="reader-empty">未找到对应论文条目。</p>`;
    return false;
  }

  const shouldRenderOriginal =
    reloadOriginal ||
    !currentPaper ||
    String(currentPaper.original || "") !== String(nextPaper.original || "") ||
    String(currentPaper.originalUrl || "") !== String(nextPaper.originalUrl || "");

  currentPaper = nextPaper;
  renderHeaderMeta(currentPaper);
  if (shouldRenderOriginal) {
    renderOriginal(currentPaper);
  }
  await renderSideContent(currentPaper);
  return true;
}

function connectEvents() {
  const source = new EventSource("/api/events");
  source.addEventListener("paper-updated", async (event) => {
    if (!paperId) {
      return;
    }
    if (shouldIgnoreLocalUpdateEvent()) {
      return;
    }
    let eventPaperId = "";
    try {
      eventPaperId = String(JSON.parse(event.data || "{}").paperId || "");
    } catch (_) {
      eventPaperId = "";
    }
    if (eventPaperId !== paperId) {
      return;
    }
    if (currentPaper?.conversationLog) {
      invalidateTextCache(currentPaper.conversationLog);
    }
    if (currentPaper?.notes) {
      invalidateTextCache(currentPaper.notes);
    }
    if (currentPaper?.translation) {
      invalidateTextCache(currentPaper.translation);
    }
    await refreshPaper({ reloadOriginal: false });
  });
}

async function loadPaper() {
  if (!paperId) {
    paperTitle.textContent = "缺少论文参数";
    paperMeta.textContent = "请从 Dashboard 点击论文标题进入阅读页。";
    originalContainer.innerHTML = `<p class="reader-empty">未提供 paperId。</p>`;
    sideContent.innerHTML = `<p class="reader-empty">未提供 paperId。</p>`;
    return;
  }

  try {
    const loaded = await refreshPaper({ reloadOriginal: true });
    if (loaded && currentPaper?.id) {
      markPaperOpened(currentPaper.id);
    }
  } catch (error) {
    paperTitle.textContent = "加载失败";
    paperMeta.textContent = error.message || "未知错误";
  }
}

document.addEventListener("click", async (event) => {
  const tabTarget = event.target.closest("[data-action='switch-view']");
  if (tabTarget && currentPaper) {
    currentView = tabTarget.dataset.view || "translation";
    await renderSideContent(currentPaper);
    return;
  }

  if (event.target.closest("#toggleStarBtn") && currentPaper) {
    const previous = Boolean(currentPaper.starred);
    const nextStarred = !previous;
    currentPaper.starred = nextStarred;
    renderHeaderMeta(currentPaper);
    try {
      const updated = await patchPaper({ starred: nextStarred });
      if (updated) {
        currentPaper = updated;
      }
      renderHeaderMeta(currentPaper);
    } catch (error) {
      currentPaper.starred = previous;
      renderHeaderMeta(currentPaper);
      window.alert(error.message || "星标更新失败，请稍后重试。");
    }
  }
});

loadPaper();
connectEvents();
