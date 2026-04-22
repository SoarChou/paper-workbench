let papers = [];

const AI_STATUS_OPTIONS = ["待整理", "待元数据", "待摘要", "待翻译", "待笔记", "待校对", "已完成"];
const READING_STATUS_OPTIONS = ["待读", "在读", "已读"];

const searchInput = document.querySelector("#searchInput");
const categoryFilter = document.querySelector("#categoryFilter");
const aiStatusFilter = document.querySelector("#aiStatusFilter");
const readingStatusFilter = document.querySelector("#readingStatusFilter");
const statsContainer = document.querySelector("#stats");
const cardsScroll = document.querySelector("#cardsScroll");
const cardsContainer = document.querySelector("#cards");
const tableBody = document.querySelector("#tableBody");
const resultMeta = document.querySelector("#resultMeta");
const liveStatus = document.querySelector("#liveStatus");
const featureTabButtons = document.querySelectorAll("[data-feature-tab]");
const featurePanels = document.querySelectorAll("[data-feature-panel]");
const cardModal = document.querySelector("#cardModal");
const summarySelectAll = document.querySelector("#summarySelectAll");
const summarySelectionMeta = document.querySelector("#summarySelectionMeta");
const summaryEditSelectedBtn = document.querySelector("#summaryEditSelectedBtn");
const summaryDeleteSelectedBtn = document.querySelector("#summaryDeleteSelectedBtn");
const summaryColumnToggles = document.querySelector("#summaryColumnToggles");
const summaryTable = document.querySelector(".summary-table");
let masonryRaf = 0;
const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
let expandedCardState = null;
let expandTxn = 0;
const CARD_EXPAND_DURATION_MS = 280;
const CARD_CLOSE_DURATION_MS = 200;
const MODAL_FADE_OUT_MS = 260;
let modalHideTimer = 0;
const localPaperUpdateExpiry = new Map();
const LOCAL_EVENT_SUPPRESS_MS = 6000;
const SUMMARY_COLUMN_CONFIG = [
  { key: "category", label: "分类" },
  { key: "published", label: "发表时间" },
  { key: "imported", label: "导入时间" },
  { key: "last-opened", label: "最后打开" },
  { key: "ai", label: "AI状态" },
  { key: "reading", label: "阅读状态" },
  { key: "venue", label: "会议" },
];
const SUMMARY_COLUMN_STORAGE_KEY = "paperWorkbench.summary.visibleColumns.v1";
const FEATURE_TAB_STORAGE_KEY = "paperWorkbench.ui.featureTab.v1";
const DEFAULT_FEATURE_TAB = "dashboard";
const summaryState = {
  sortKey: "importedAt",
  sortDirection: "desc",
  selectedIds: new Set(),
  editingPaperId: "",
  visibleColumns: loadSummaryVisibleColumns(),
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function toId(value) {
  return String(value ?? "").trim();
}

function loadSummaryVisibleColumns() {
  const fallback = new Set(SUMMARY_COLUMN_CONFIG.map((column) => column.key));
  try {
    const raw = window.localStorage.getItem(SUMMARY_COLUMN_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return fallback;
    }
    const valid = parsed
      .map((item) => String(item || ""))
      .filter((key) => SUMMARY_COLUMN_CONFIG.some((column) => column.key === key));
    if (!valid.length) {
      return fallback;
    }
    return new Set(valid);
  } catch (_) {
    return fallback;
  }
}

function persistSummaryVisibleColumns() {
  try {
    window.localStorage.setItem(SUMMARY_COLUMN_STORAGE_KEY, JSON.stringify([...summaryState.visibleColumns]));
  } catch (_) {
    // ignore storage failures
  }
}

function isValidFeatureTab(tab) {
  return [...featureTabButtons].some((button) => button.dataset.featureTab === tab);
}

function loadFeatureTab() {
  try {
    const saved = String(window.localStorage.getItem(FEATURE_TAB_STORAGE_KEY) || "").trim();
    if (saved && isValidFeatureTab(saved)) {
      return saved;
    }
  } catch (_) {
    // ignore storage failures
  }
  const activeTab = document.querySelector("[data-feature-tab].active")?.dataset.featureTab;
  if (activeTab && isValidFeatureTab(activeTab)) {
    return activeTab;
  }
  return DEFAULT_FEATURE_TAB;
}

function persistFeatureTab(tab) {
  try {
    window.localStorage.setItem(FEATURE_TAB_STORAGE_KEY, tab);
  } catch (_) {
    // ignore storage failures
  }
}

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

function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (/^\d{4}$/.test(text)) {
    return `${text}-01-01`;
  }
  return "";
}

function toTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) {
    return 0;
  }
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  const asDate = normalizeDateOnly(text);
  if (!asDate) {
    return 0;
  }
  const dateParsed = Date.parse(`${asDate}T00:00:00Z`);
  return Number.isNaN(dateParsed) ? 0 : dateParsed;
}

function formatDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "—";
  }
  const dateOnly = normalizeDateOnly(text);
  if (!dateOnly) {
    return text;
  }
  return dateOnly;
}

function compareBySortKey(leftPaper, rightPaper, sortKey) {
  const left = leftPaper || {};
  const right = rightPaper || {};
  if (["importedAt", "publishedAt", "lastOpenedAt"].includes(sortKey)) {
    return toTimestamp(left[sortKey]) - toTimestamp(right[sortKey]);
  }
  if (sortKey === "year") {
    return Number(left.year || 0) - Number(right.year || 0);
  }
  return String(left[sortKey] || "").localeCompare(String(right[sortKey] || ""), "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function sortedPapers(items) {
  const cloned = [...items];
  cloned.sort((leftPaper, rightPaper) => {
    const byKey = compareBySortKey(leftPaper, rightPaper, summaryState.sortKey);
    if (byKey !== 0) {
      return summaryState.sortDirection === "asc" ? byKey : -byKey;
    }
    const fallback = compareBySortKey(leftPaper, rightPaper, "title");
    return fallback || compareBySortKey(leftPaper, rightPaper, "id");
  });
  return cloned;
}

function buildReaderUrl(paperId, view = "original") {
  const params = new URLSearchParams({
    paperId: toId(paperId),
    view: String(view || "original"),
  });
  return `/web/reader.html?${params.toString()}`;
}

function isPlaceholderText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return true;
  }
  return /待(补充|生成|整理|完善)|稍后|占位|placeholder|tbd|todo|暂无|待 ai/i.test(text);
}

function resolveStatus(status) {
  const current = String(status || "待整理").trim();
  if (!current || current === "待整理" || current === "待AI整理") {
    return { text: "正在整理论文", tone: "working" };
  }
  if (current === "待元数据") {
    return { text: "正在补全元数据", tone: "working" };
  }
  if (current === "待摘要") {
    return { text: "正在生成摘要", tone: "working" };
  }
  if (current === "待翻译") {
    return { text: "正在生成翻译", tone: "working" };
  }
  if (current === "待笔记") {
    return { text: "正在整理笔记", tone: "working" };
  }
  if (current === "待校对") {
    return { text: "正在校对内容", tone: "working" };
  }
  if (current === "已完成") {
    return { text: "已完成", tone: "done" };
  }
  if (/失败|错误|中断/.test(current)) {
    return { text: current, tone: "error" };
  }
  if (current.startsWith("正在")) {
    return { text: current, tone: "working" };
  }
  if (current.startsWith("待")) {
    return { text: current.replace(/^待/, "正在"), tone: "pending" };
  }
  return { text: current, tone: "pending" };
}

function resolveReadingTone(status) {
  const current = String(status || "待读").trim();
  if (current === "已读") {
    return "done";
  }
  if (current === "在读") {
    return "working";
  }
  return "pending";
}

function renderStatusChip(text, tone, extraClass = "") {
  const safeTone = ["done", "working", "pending", "error"].includes(tone) ? tone : "pending";
  const safeText = String(text || "").trim() || "—";
  return `
    <span class="status-chip tone-${safeTone} ${extraClass}" title="${escapeHtml(safeText)}">
      <span class="status-dot"></span>
      <span class="status-chip-text">${escapeHtml(safeText)}</span>
    </span>
  `;
}

function renderStarButton(paperId, starred, extraClass = "") {
  const active = Boolean(starred);
  const title = active ? "取消星标" : "添加星标";
  return `<button class="paper-star-btn ${extraClass} ${active ? "is-starred" : ""}" type="button" data-action="toggle-star" data-id="${escapeHtml(paperId)}" data-role="paper-star" aria-pressed="${active ? "true" : "false"}" title="${title}">${active ? "★" : "☆"}</button>`;
}

function markLocalPaperUpdate(paperId) {
  if (!paperId) {
    return;
  }
  localPaperUpdateExpiry.set(paperId, Date.now() + LOCAL_EVENT_SUPPRESS_MS);
}

function consumeIfLocalPaperUpdate(paperId) {
  const now = Date.now();
  for (const [id, expiry] of localPaperUpdateExpiry.entries()) {
    if (expiry <= now) {
      localPaperUpdateExpiry.delete(id);
    }
  }
  const expiry = localPaperUpdateExpiry.get(paperId);
  if (!expiry || expiry <= now) {
    return false;
  }
  localPaperUpdateExpiry.delete(paperId);
  return true;
}

function clearModalHideTimer() {
  if (modalHideTimer) {
    window.clearTimeout(modalHideTimer);
    modalHideTimer = 0;
  }
}

function showCardModal() {
  if (!cardModal) {
    return;
  }
  clearModalHideTimer();
  cardModal.hidden = false;
  cardModal.classList.add("is-visible", "is-card-mode");
}

function hideCardModal({ immediate = false } = {}) {
  if (!cardModal) {
    return;
  }
  cardModal.classList.remove("is-visible", "is-card-mode", "is-card-expanded");
  if (immediate) {
    clearModalHideTimer();
    cardModal.hidden = true;
    return;
  }
  clearModalHideTimer();
  modalHideTimer = window.setTimeout(() => {
    modalHideTimer = 0;
    if (!cardModal.classList.contains("is-visible")) {
      cardModal.hidden = true;
    }
  }, MODAL_FADE_OUT_MS);
}

function switchFeatureTab(tab) {
  const targetTab = isValidFeatureTab(tab) ? tab : DEFAULT_FEATURE_TAB;
  featureTabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.featureTab === targetTab);
  });
  featurePanels.forEach((panel) => {
    const active = panel.dataset.featurePanel === targetTab;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
    panel.setAttribute("aria-hidden", String(!active));
  });
  persistFeatureTab(targetTab);
  closeCardExpand({ immediate: true });
}

function buildOptions(options, currentValue, { includeAll = false, allLabel = "全部状态" } = {}) {
  const items = includeAll ? [`<option value="all">${allLabel}</option>`] : [];
  items.push(
    ...options.map((option) => `<option value="${option}" ${currentValue === option ? "selected" : ""}>${option}</option>`),
  );
  return items.join("");
}

function syncStaticSelects() {
  const currentAiFilter = aiStatusFilter.value || "all";
  const currentReadingFilter = readingStatusFilter.value || "all";
  aiStatusFilter.innerHTML = buildOptions(AI_STATUS_OPTIONS, currentAiFilter, { includeAll: true });
  readingStatusFilter.innerHTML = buildOptions(READING_STATUS_OPTIONS, currentReadingFilter, { includeAll: true });
}

function filteredPapers() {
  const search = normalize(searchInput.value);
  const category = categoryFilter.value;
  const aiStatus = aiStatusFilter.value;
  const readingStatus = readingStatusFilter.value;

  return papers.filter((paper) => {
    const haystack = normalize([
      paper.title,
      paper.titleZh,
      paper.authors,
      paper.venue,
      paper.category,
      paper.summary,
      paper.focus,
      paper.aiNextAction,
      ...(paper.takeaways || []),
    ].join(" "));
    const matchesSearch = !search || haystack.includes(search);
    const matchesCategory = category === "all" || paper.category === category;
    const matchesAiStatus = aiStatus === "all" || paper.aiStatus === aiStatus;
    const matchesReadingStatus = readingStatus === "all" || paper.readingStatus === readingStatus;
    return matchesSearch && matchesCategory && matchesAiStatus && matchesReadingStatus;
  });
}

function renderStats(items) {
  const aiPending = papers.filter((paper) => paper.aiStatus !== "已完成").length;
  const reading = papers.filter((paper) => paper.readingStatus === "在读").length;
  const done = papers.filter((paper) => paper.aiStatus === "已完成").length;
  const stats = [
    { label: "总论文", value: papers.length, note: "库内条目" },
    { label: "当前结果", value: items.length, note: "筛选后" },
    { label: "待处理", value: aiPending, note: `在读 ${reading} · 已完成 ${done}` },
  ];

  statsContainer.innerHTML = stats.map((stat) => `
    <article class="stat">
      <p class="stat-label">${escapeHtml(stat.label)}</p>
      <p class="stat-value">${escapeHtml(stat.value)}</p>
      <p class="stat-note">${escapeHtml(stat.note)}</p>
    </article>
  `).join("");
}

function applyMasonryLayout() {
  if (!cardsContainer) {
    return;
  }
  const cards = [...cardsContainer.querySelectorAll(".card")];
  if (!cards.length) {
    cardsContainer.style.height = "auto";
    return;
  }

  const containerWidth = cardsContainer.clientWidth;
  if (!containerWidth) {
    return;
  }
  const containerStyle = window.getComputedStyle(cardsContainer);
  const paddingLeft = parseFloat(containerStyle.paddingLeft) || 0;
  const paddingRight = parseFloat(containerStyle.paddingRight) || 0;
  const paddingTop = parseFloat(containerStyle.paddingTop) || 0;
  const paddingBottom = parseFloat(containerStyle.paddingBottom) || 0;
  const contentWidth = containerWidth - paddingLeft - paddingRight;
  if (contentWidth <= 0) {
    return;
  }

  const gap = 12;
  const minColumnWidth = 280;
  let columns = Math.max(1, Math.floor((contentWidth + gap) / (minColumnWidth + gap)));
  if (window.innerWidth <= 980) {
    columns = Math.min(columns, 2);
  }
  if (window.innerWidth <= 720) {
    columns = 1;
  }
  columns = Math.min(columns, cards.length);
  const columnWidth = (contentWidth - gap * (columns - 1)) / columns;
  const heights = Array(columns).fill(paddingTop);
  const revealCards = [];

  cards.forEach((card) => {
    if (!card.classList.contains("is-laid-out")) {
      revealCards.push(card);
    }
    card.style.width = `${columnWidth}px`;
    card.style.position = "absolute";
  });

  cards.forEach((card) => {
    const minHeight = Math.min(...heights);
    const columnIndex = heights.indexOf(minHeight);
    const left = paddingLeft + (columnWidth + gap) * columnIndex;
    const top = heights[columnIndex];
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    heights[columnIndex] = top + card.offsetHeight + gap;
  });

  const tallest = Math.max(...heights);
  const shadowBuffer = 22;
  cardsContainer.style.height = `${Math.max(paddingTop + paddingBottom + shadowBuffer, tallest + paddingBottom - gap + shadowBuffer)}px`;
  if (revealCards.length) {
    window.requestAnimationFrame(() => {
      revealCards.forEach((card) => card.classList.add("is-laid-out"));
    });
  }
}

function scheduleMasonry() {
  if (masonryRaf) {
    window.cancelAnimationFrame(masonryRaf);
  }
  masonryRaf = window.requestAnimationFrame(() => {
    masonryRaf = 0;
    applyMasonryLayout();
  });
}

function getExpandedTargetRect() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const horizontalInset = viewportWidth <= 720 ? 10 : 44;
  const verticalInset = viewportWidth <= 720 ? 10 : 38;
  const width = Math.round(Math.min(680, viewportWidth - horizontalInset * 2));
  const height = Math.round(Math.min(560, viewportHeight - verticalInset * 2, Math.max(400, viewportHeight * 0.68)));
  return {
    left: Math.round((viewportWidth - width) / 2),
    top: Math.round((viewportHeight - height) / 2),
    width,
    height,
  };
}

function setCardFixedRect(card, rect) {
  card.style.position = "fixed";
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.top}px`;
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  card.style.margin = "0";
  card.style.zIndex = "160";
}

function clearFloatingInlineStyle(card) {
  card.style.position = "";
  card.style.left = "";
  card.style.top = "";
  card.style.width = "";
  card.style.height = "";
  card.style.margin = "";
  card.style.zIndex = "";
  card.style.transform = "";
  card.style.opacity = "";
  card.style.willChange = "";
}

function clearCardOwnAnimations(card) {
  if (!card || typeof card.getAnimations !== "function") {
    return;
  }
  let animations = [];
  try {
    animations = card.getAnimations({ subtree: false });
  } catch (_) {
    animations = card.getAnimations();
  }
  animations.forEach((animation) => {
    const effect = animation.effect;
    if (!effect || !("target" in effect) || effect.target === card) {
      animation.cancel();
    }
  });
}

function normalizeCardsAfterExpand() {
  const dirtyCards = cardsContainer.querySelectorAll(".card.is-floating, .card.is-expanding, .card.is-expanded, .card.is-transitioning");
  dirtyCards.forEach((card) => {
    clearCardOwnAnimations(card);
    card.classList.remove("is-floating", "is-expanding", "is-expanded", "is-transitioning");
    clearFloatingInlineStyle(card);
  });
}

function animateCardRect(card, fromRect, toRect, duration) {
  if (prefersReducedMotion?.matches) {
    setCardFixedRect(card, toRect);
    return Promise.resolve();
  }
  const animation = card.animate([
    {
      left: `${fromRect.left}px`,
      top: `${fromRect.top}px`,
      width: `${fromRect.width}px`,
      height: `${fromRect.height}px`,
      borderRadius: "16px",
      boxShadow: "0 18px 36px rgba(15, 23, 42, 0.12)",
    },
    {
      left: `${toRect.left}px`,
      top: `${toRect.top}px`,
      width: `${toRect.width}px`,
      height: `${toRect.height}px`,
      borderRadius: "22px",
      boxShadow: "0 30px 72px rgba(15, 23, 42, 0.24)",
    },
  ], {
    duration,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    fill: "forwards",
  });
  return animation.finished.catch(() => {});
}

function findCardByPaperId(paperId) {
  const targetPaperId = toId(paperId);
  return [...cardsContainer.querySelectorAll(".card")].find((card) => toId(card.dataset.id) === targetPaperId) || null;
}

async function openCardExpand(paper, sourceCard) {
  if (!cardModal || !paper || !sourceCard || !sourceCard.isConnected) {
    return;
  }
  const txn = ++expandTxn;
  if (expandedCardState?.card === sourceCard) {
    return;
  }
  if (expandedCardState) {
    await closeCardExpand({ immediate: true });
  }
  if (masonryRaf) {
    window.cancelAnimationFrame(masonryRaf);
    masonryRaf = 0;
  }
  normalizeCardsAfterExpand();
  applyMasonryLayout();

  const startRect = sourceCard.getBoundingClientRect();
  if (!startRect.width || !startRect.height) {
    return;
  }
  const containerRect = cardsContainer.getBoundingClientRect();
  const scrollTop = cardsScroll?.scrollTop || 0;
  const scrollLeft = cardsScroll?.scrollLeft || 0;
  const placeholder = document.createElement("div");
  placeholder.className = "card-anchor-placeholder";
  placeholder.style.position = "absolute";
  placeholder.style.left = `${startRect.left - containerRect.left + scrollLeft}px`;
  placeholder.style.top = `${startRect.top - containerRect.top + scrollTop}px`;
  placeholder.style.width = `${startRect.width}px`;
  placeholder.style.height = `${startRect.height}px`;
  placeholder.style.borderRadius = "16px";
  sourceCard.parentElement?.insertBefore(placeholder, sourceCard);
  expandedCardState = {
    card: sourceCard,
    paperId: toId(paper.id),
    startRect,
    placeholder,
  };

  clearCardOwnAnimations(sourceCard);
  sourceCard.classList.add("is-floating", "is-transitioning", "is-expanding", "is-expanded");
  cardModal.appendChild(sourceCard);
  setCardFixedRect(sourceCard, startRect);
  sourceCard.style.transform = "none";
  sourceCard.style.opacity = "1";
  sourceCard.style.willChange = "left, top, width, height, border-radius, box-shadow";

  showCardModal();
  cardsContainer.classList.add("cards-freeze");
  document.body.classList.add("modal-open");

  const targetRect = getExpandedTargetRect();
  await animateCardRect(sourceCard, startRect, targetRect, CARD_EXPAND_DURATION_MS);
  if (txn !== expandTxn || !expandedCardState || expandedCardState.card !== sourceCard) {
    return;
  }
  clearCardOwnAnimations(sourceCard);
  setCardFixedRect(sourceCard, targetRect);
  sourceCard.classList.remove("is-transitioning");
  cardModal.classList.add("is-card-expanded");
}

async function closeCardExpand({ immediate = false, duration = CARD_CLOSE_DURATION_MS } = {}) {
  expandTxn += 1;
  if (!expandedCardState) {
    if (cardModal && !cardModal.hidden) {
      hideCardModal({ immediate });
      document.body.classList.remove("modal-open");
    }
    cardsContainer.classList.remove("cards-freeze");
    normalizeCardsAfterExpand();
    applyMasonryLayout();
    return;
  }
  const { card, startRect, placeholder } = expandedCardState;
  expandedCardState = null;

  const currentRect = card.getBoundingClientRect();
  const endRect = placeholder?.isConnected ? placeholder.getBoundingClientRect() : startRect;
  card.classList.remove("is-expanded", "is-expanding");
  card.classList.add("is-transitioning");
  let startedModalFadeOut = false;

  if (!immediate) {
    hideCardModal({ immediate: false });
    startedModalFadeOut = true;
    await animateCardRect(card, currentRect, endRect, duration);
  }

  clearCardOwnAnimations(card);
  clearFloatingInlineStyle(card);
  card.classList.remove("is-floating", "is-expanding", "is-transitioning");
  if (placeholder && placeholder.parentElement) {
    placeholder.replaceWith(card);
  } else if (card.parentElement === cardModal) {
    card.remove();
  }
  normalizeCardsAfterExpand();
  if (!startedModalFadeOut) {
    hideCardModal({ immediate });
  }
  cardsContainer.classList.remove("cards-freeze");
  document.body.classList.remove("modal-open");
  applyMasonryLayout();
  window.requestAnimationFrame(() => {
    normalizeCardsAfterExpand();
    applyMasonryLayout();
  });
}

function openReaderPage(paperId, view = "original") {
  window.location.assign(buildReaderUrl(paperId, view));
}

function renderCards(items) {
  if (!items.length) {
    cardsContainer.innerHTML = `<div class="empty">没有匹配的论文，换个条件试试。</div>`;
    cardsContainer.style.height = "auto";
    return;
  }

  cardsContainer.innerHTML = items.map((paper) => {
    const paperId = toId(paper.id);
    const readerOriginalHref = buildReaderUrl(paperId, "original");
    const title = escapeHtml(paper.titleZh || paper.title);
    const titleEn = escapeHtml(paper.title);
    const metaAuthors = escapeHtml([paper.authors, paper.venue].filter(Boolean).join(" · "));
    const aiStatus = paper.aiStatus || "待整理";
    const status = resolveStatus(aiStatus);
    const readingStatus = paper.readingStatus || "待读";
    const readingTone = resolveReadingTone(readingStatus);
    const starred = Boolean(paper.starred);
    const qaCount = Math.max(0, Number(paper.qaCount || 0));
    const nextAction = escapeHtml(paper.aiNextAction || "等待 AI 继续处理");
    const fullTakeaways = (paper.takeaways || []).filter(Boolean);
    const previewTakeaways = (paper.takeaways || []).slice(0, 2);
    const showSummarySkeleton = isPlaceholderText(paper.summary);
    const original = paper.original || paper.originalUrl;
    const summaryHtml = showSummarySkeleton
      ? `
        <div class="card-skeleton card-skeleton-preview">
          <p class="skeleton-caption">摘要生成中…</p>
          <div class="skeleton-line w-95"></div>
          <div class="skeleton-line w-88"></div>
          <div class="skeleton-line w-72"></div>
        </div>
      `
      : `<p class="card-summary card-summary-preview">${escapeHtml(paper.summary)}</p>`;

    const expandedSummaryHtml = showSummarySkeleton
      ? `
        <div class="card-skeleton card-skeleton-expanded">
          <p class="skeleton-caption">摘要生成中…</p>
          <div class="skeleton-line w-95"></div>
          <div class="skeleton-line w-88"></div>
          <div class="skeleton-line w-84"></div>
          <div class="skeleton-line w-76"></div>
        </div>
      `
      : `<p class="card-summary card-summary-full">${escapeHtml(paper.summary || "暂无摘要。")}</p>`;
    const actionButtons = `
      <button class="mini-btn" data-action="open-reader" data-id="${escapeHtml(paperId)}" data-view="original" type="button">阅读页</button>
      ${original ? `<a class="mini-btn" href="${safeUrl(original)}" target="_blank" rel="noreferrer">原文</a>` : ""}
      ${paper.citation ? `<button class="mini-btn" data-action="copy-citation" data-id="${escapeHtml(paperId)}" type="button">复制引用</button>` : ""}
      <button class="reading-toggle tone-${readingTone}" type="button" data-action="cycle-reading-status" data-id="${escapeHtml(paperId)}">阅读：${escapeHtml(readingStatus)}</button>
    `;

    return `
      <article class="card" data-action="open-card-expand" data-id="${escapeHtml(paperId)}">
        <div class="card-top">
          <div>
            <h3>
              <a class="card-title-link" href="${readerOriginalHref}" data-action="open-reader" data-id="${escapeHtml(paperId)}" data-view="original">
                ${title}
              </a>
            </h3>
            <p class="card-title-en" title="${titleEn}">${titleEn}</p>
            <p class="meta card-meta-authors" title="${metaAuthors}">${metaAuthors}</p>
          </div>
          <div class="card-expanded-toolbar">
            <button class="card-expanded-close" type="button" data-action="close-card-expand" aria-label="收起">×</button>
          </div>
        </div>
        <div class="tags">
          ${renderStarButton(paperId, starred, "inline-star-btn")}
          <span class="tag tag-ai tone-${status.tone}">${escapeHtml(aiStatus)}</span>
          <span class="tag">${escapeHtml(paper.category || "未分类")}</span>
          <span class="tag">${escapeHtml(paper.year || "-")}</span>
          ${qaCount ? `<span class="tag tag-qa" title="问答记录">${escapeHtml(`${qaCount} 条问答`)}</span>` : ""}
          <span class="tag tag-reading tone-${readingTone}" data-role="reading-status">${escapeHtml(readingStatus)}</span>
        </div>
        ${summaryHtml}
        ${previewTakeaways.length ? `<ul class="detail-list detail-list-preview">${previewTakeaways.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        <div class="card-expanded-body">
          <section class="card-expanded-section">
            <h4>摘要</h4>
            ${expandedSummaryHtml}
          </section>
          <section class="card-expanded-section">
            <h4>关键信息</h4>
            ${fullTakeaways.length
    ? `<ul class="detail-list detail-list-full">${fullTakeaways.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p class='card-suggest'>暂无关键信息。</p>"}
          </section>
        </div>
        <div class="card-footer">
          <div class="card-workflow" role="status" aria-label="论文处理下一步">
            <span class="card-workflow-label">AI 下一步</span>
            <span class="card-workflow-value">${nextAction}</span>
          </div>
          <div class="card-actions card-actions-preview">
            ${actionButtons}
          </div>
        </div>
      </article>
    `;
  }).join("");
  scheduleMasonry();
}

function sanitizeSummarySelection() {
  const validIds = new Set(papers.map((paper) => toId(paper.id)));
  [...summaryState.selectedIds].forEach((paperId) => {
    if (!validIds.has(paperId)) {
      summaryState.selectedIds.delete(paperId);
    }
  });
  if (summaryState.editingPaperId && !validIds.has(summaryState.editingPaperId)) {
    summaryState.editingPaperId = "";
  }
}

function setSummarySelectionMeta(items) {
  if (!summarySelectionMeta) {
    return;
  }
  const selectedCount = summaryState.selectedIds.size;
  const total = items.length;
  summarySelectionMeta.textContent = `已选 ${selectedCount} 项 / 当前 ${total} 项`;
  if (summaryEditSelectedBtn) {
    summaryEditSelectedBtn.disabled = selectedCount !== 1;
  }
  if (summaryDeleteSelectedBtn) {
    summaryDeleteSelectedBtn.disabled = selectedCount < 1;
  }
}

function syncSummarySelectAll(items) {
  if (!summarySelectAll) {
    return;
  }
  const ids = items.map((paper) => toId(paper.id)).filter(Boolean);
  if (!ids.length) {
    summarySelectAll.checked = false;
    summarySelectAll.indeterminate = false;
    return;
  }
  const checkedCount = ids.reduce((count, paperId) => count + (summaryState.selectedIds.has(paperId) ? 1 : 0), 0);
  summarySelectAll.checked = checkedCount === ids.length;
  summarySelectAll.indeterminate = checkedCount > 0 && checkedCount < ids.length;
}

function applySortHeaderState() {
  document.querySelectorAll('[data-action="sort-summary"]').forEach((button) => {
    if (!button.dataset.keyLabel) {
      button.dataset.keyLabel = button.textContent.replace(/[↑↓↕]\s*$/, "").trim();
    }
    const active = button.dataset.key === summaryState.sortKey;
    button.classList.toggle("active", active);
    const indicator = active ? (summaryState.sortDirection === "asc" ? "↑" : "↓") : "↕";
    button.textContent = `${button.dataset.keyLabel} ${indicator}`;
  });
}

function applySummaryColumnVisibility() {
  if (!summaryTable) {
    return;
  }
  SUMMARY_COLUMN_CONFIG.forEach((column) => {
    const hidden = !summaryState.visibleColumns.has(column.key);
    summaryTable.classList.toggle(`hide-col-${column.key}`, hidden);
  });
}

function renderSummaryColumnToggles() {
  if (!summaryColumnToggles) {
    return;
  }
  summaryColumnToggles.innerHTML = SUMMARY_COLUMN_CONFIG.map((column) => {
    const active = summaryState.visibleColumns.has(column.key);
    return `<button class="column-toggle-btn ${active ? "active" : ""}" type="button" data-action="toggle-column-visibility" data-column-key="${escapeHtml(column.key)}" aria-pressed="${active ? "true" : "false"}" title="显示/隐藏：${escapeHtml(column.label)}">${escapeHtml(column.label)}</button>`;
  }).join("");
}

function toggleSummaryColumnVisibility(columnKey) {
  if (!columnKey || !SUMMARY_COLUMN_CONFIG.some((column) => column.key === columnKey)) {
    return;
  }
  const isVisible = summaryState.visibleColumns.has(columnKey);
  const visibleCount = summaryState.visibleColumns.size;
  if (isVisible && visibleCount <= 1) {
    return;
  }
  if (isVisible) {
    summaryState.visibleColumns.delete(columnKey);
  } else {
    summaryState.visibleColumns.add(columnKey);
  }
  persistSummaryVisibleColumns();
  renderSummaryColumnToggles();
  applySummaryColumnVisibility();
}

function renderInlineEditorRow(paper) {
  const paperId = toId(paper.id);
  if (!paperId || summaryState.editingPaperId !== paperId) {
    return "";
  }
  const publishedAt = normalizeDateOnly(paper.publishedAt || (paper.year ? `${paper.year}-01-01` : ""));
  return `
    <tr class="summary-inline-editor-row" data-editor-for="${escapeHtml(paperId)}">
      <td colspan="10">
        <form class="summary-inline-form" data-action="summary-inline-submit" data-id="${escapeHtml(paperId)}">
          <div class="summary-inline-grid">
            <label class="summary-inline-field">
              <span>中文标题</span>
              <input name="titleZh" type="text" value="${escapeHtml(paper.titleZh || "")}" placeholder="中文标题" />
            </label>
            <label class="summary-inline-field">
              <span>分类</span>
              <input name="category" type="text" value="${escapeHtml(paper.category || "")}" placeholder="分类" />
            </label>
            <label class="summary-inline-field">
              <span>年份</span>
              <input name="year" type="number" min="1900" max="2100" value="${escapeHtml(paper.year || "")}" placeholder="年份" />
            </label>
            <label class="summary-inline-field">
              <span>发表时间</span>
              <input name="publishedAt" type="date" value="${escapeHtml(publishedAt)}" />
            </label>
            <label class="summary-inline-field">
              <span>AI状态</span>
              <select name="aiStatus">
                ${AI_STATUS_OPTIONS.map((option) => `<option value="${escapeHtml(option)}" ${option === (paper.aiStatus || "待整理") ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
              </select>
            </label>
            <label class="summary-inline-field">
              <span>阅读状态</span>
              <select name="readingStatus">
                ${READING_STATUS_OPTIONS.map((option) => `<option value="${escapeHtml(option)}" ${option === (paper.readingStatus || "待读") ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
              </select>
            </label>
            <div class="summary-inline-advanced-wrap">
              <details class="summary-inline-advanced">
                <summary>更多字段（会议 / DOI）</summary>
                <div class="summary-inline-advanced-grid">
                  <label class="summary-inline-field">
                    <span>会议 / 期刊</span>
                    <input name="venue" type="text" value="${escapeHtml(paper.venue || "")}" placeholder="会议 / 期刊" />
                  </label>
                  <label class="summary-inline-field">
                    <span>DOI</span>
                    <input name="doi" type="text" value="${escapeHtml(paper.doi || "")}" placeholder="DOI" />
                  </label>
                </div>
              </details>
            </div>
            <div class="summary-inline-row-actions">
              <button class="summary-row-btn neutral" type="button" data-action="summary-inline-cancel" data-id="${escapeHtml(paperId)}">取消</button>
              <button class="summary-row-btn" type="submit">保存</button>
            </div>
          </div>
        </form>
      </td>
    </tr>
  `;
}

function renderTable(items) {
  const sortedItems = sortedPapers(items);
  if (!sortedItems.length) {
    summaryState.editingPaperId = "";
    tableBody.innerHTML = `<tr><td colspan="10" class="empty">暂无符合条件的论文。</td></tr>`;
    setSummarySelectionMeta(sortedItems);
    syncSummarySelectAll(sortedItems);
    applySortHeaderState();
    return;
  }

  tableBody.innerHTML = sortedItems.map((paper) => {
    const paperId = toId(paper.id);
    const checked = summaryState.selectedIds.has(paperId) ? "checked" : "";
    const readerHref = buildReaderUrl(paperId, "original");
    const aiStatus = paper.aiStatus || "待整理";
    const aiTone = resolveStatus(aiStatus).tone;
    const readingStatus = paper.readingStatus || "待读";
    const readingTone = resolveReadingTone(readingStatus);
    const starred = Boolean(paper.starred);
    const titleZh = paper.titleZh || paper.title || "未命名论文";
    const titleEn = paper.title || "";
    const titleTooltip = titleEn && titleEn !== titleZh ? `${titleZh} ｜ ${titleEn}` : titleZh;
    const venue = paper.venue || "";
    const category = paper.category || "";
    return `
      <tr data-paper-id="${escapeHtml(paperId)}">
        <td class="summary-col-checkbox">
          <input type="checkbox" data-action="select-summary-row" data-id="${escapeHtml(paperId)}" ${checked} />
        </td>
        <td class="summary-col-title">
          <div class="summary-title-main">
            ${renderStarButton(paperId, starred, "summary-star-btn")}
            <a class="summary-title-link" href="${readerHref}" data-action="open-reader" data-id="${escapeHtml(paperId)}" data-view="original" title="${escapeHtml(titleTooltip)}">
              <span class="summary-title-text">${escapeHtml(titleZh)}</span>
            </a>
          </div>
        </td>
        <td class="summary-col-category"><span class="summary-ellipsis summary-cell-ellipsis" title="${escapeHtml(category)}">${escapeHtml(category)}</span></td>
        <td class="summary-col-published summary-col-time"><span class="summary-cell-ellipsis" title="${escapeHtml(formatDateOnly(paper.publishedAt || (paper.year ? `${paper.year}-01-01` : "")))}">${escapeHtml(formatDateOnly(paper.publishedAt || (paper.year ? `${paper.year}-01-01` : "")))}</span></td>
        <td class="summary-col-imported summary-col-time"><span class="summary-cell-ellipsis" title="${escapeHtml(formatDateOnly(paper.importedAt))}">${escapeHtml(formatDateOnly(paper.importedAt))}</span></td>
        <td class="summary-col-last-opened summary-col-time"><span class="summary-cell-ellipsis" title="${escapeHtml(formatDateOnly(paper.lastOpenedAt))}">${escapeHtml(formatDateOnly(paper.lastOpenedAt))}</span></td>
        <td class="summary-col-ai summary-col-status" data-role="ai-status-cell">${renderStatusChip(aiStatus, aiTone, "status-chip-compact")}</td>
        <td class="summary-col-reading summary-col-status" data-role="reading-status-cell">${renderStatusChip(readingStatus, readingTone, "status-chip-compact")}</td>
        <td class="summary-col-venue"><span class="summary-ellipsis summary-cell-ellipsis" title="${escapeHtml(venue)}">${escapeHtml(venue)}</span></td>
        <td class="summary-col-actions summary-action-cell">
          <div class="summary-row-actions">
            <button class="summary-icon-btn" type="button" data-action="summary-edit-row" data-id="${escapeHtml(paperId)}" title="编辑" aria-label="编辑">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 20h4l10-10-4-4L4 16v4z"></path>
                <path d="M13 7l4 4"></path>
              </svg>
            </button>
            <button class="summary-icon-btn danger" type="button" data-action="summary-delete-row" data-id="${escapeHtml(paperId)}" title="删除" aria-label="删除">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 7h16"></path>
                <path d="M9 7V5h6v2"></path>
                <path d="M8 7l1 12h6l1-12"></path>
                <path d="M10 10v7M14 10v7"></path>
              </svg>
            </button>
          </div>
        </td>
      </tr>
      ${renderInlineEditorRow(paper)}
    `;
  }).join("");

  setSummarySelectionMeta(sortedItems);
  syncSummarySelectAll(sortedItems);
  applySortHeaderState();
}

function renderCategoryFilter() {
  const categories = [...new Set(papers.map((paper) => paper.category).filter(Boolean))];
  const currentCategory = categoryFilter.value;
  categoryFilter.innerHTML = `<option value="all">全部分类</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  if ([...categoryFilter.options].some((option) => option.value === currentCategory)) {
    categoryFilter.value = currentCategory;
  }
}

function render() {
  syncStaticSelects();
  sanitizeSummarySelection();
  applySummaryColumnVisibility();
  renderCategoryFilter();
  const items = filteredPapers();
  renderStats(items);
  renderCards(items);
  renderTable(items);
  resultMeta.textContent = `共 ${items.length} 篇结果 · 待办 ${items.filter((paper) => paper.aiStatus !== "已完成").length} 篇`;
}

function refreshStatsMetaAndTable() {
  sanitizeSummarySelection();
  const items = filteredPapers();
  renderStats(items);
  renderTable(items);
  resultMeta.textContent = `共 ${items.length} 篇结果 · 待办 ${items.filter((paper) => paper.aiStatus !== "已完成").length} 篇`;
}

function openInlineEditor(paperId) {
  const id = toId(paperId);
  if (!id) {
    return;
  }
  const target = papers.find((item) => toId(item.id) === id);
  if (!target) {
    return;
  }
  summaryState.editingPaperId = id;
  renderTable(filteredPapers());
}

function closeInlineEditor() {
  summaryState.editingPaperId = "";
  renderTable(filteredPapers());
}

function getVisibleSortedItems() {
  return sortedPapers(filteredPapers());
}

function toggleSummaryRowSelection(paperId, checked) {
  const id = toId(paperId);
  if (!id) {
    return;
  }
  if (checked) {
    summaryState.selectedIds.add(id);
  } else {
    summaryState.selectedIds.delete(id);
  }
  const items = filteredPapers();
  setSummarySelectionMeta(items);
  syncSummarySelectAll(items);
}

async function requestDeleteSelectedPapers() {
  const paperIds = [...summaryState.selectedIds];
  if (!paperIds.length) {
    return;
  }
  const confirmed = window.confirm(`确认删除已选 ${paperIds.length} 条论文记录吗？该操作不可撤销。`);
  if (!confirmed) {
    return;
  }
  await requestDeletePapers(paperIds);
  paperIds.forEach((paperId) => {
    summaryState.selectedIds.delete(paperId);
  });
  if (summaryState.editingPaperId && paperIds.includes(summaryState.editingPaperId)) {
    summaryState.editingPaperId = "";
  }
  await fetchPapers();
}

async function requestDeletePapers(paperIds) {
  if (!paperIds.length) {
    return;
  }
  const response = await fetch("/api/papers/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperIds }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "删除失败");
  }
  paperIds.forEach((paperId) => {
    markLocalPaperUpdate(paperId);
  });
}

async function patchPaperRecord(paperId, patch) {
  const response = await fetch("/api/papers/patch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, patch }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "更新失败");
  }
  markLocalPaperUpdate(paperId);
  return payload.paper || null;
}

function syncStarButtonsUI(paperId, starred) {
  const targetPaperId = toId(paperId);
  const active = Boolean(starred);
  document.querySelectorAll("[data-role='paper-star']").forEach((button) => {
    if (toId(button.dataset.id) !== targetPaperId) {
      return;
    }
    button.classList.toggle("is-starred", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute("title", active ? "取消星标" : "添加星标");
    button.textContent = active ? "★" : "☆";
  });
}

function syncReadingStatusUI(paperId, status) {
  const targetPaperId = toId(paperId);
  const readingTone = resolveReadingTone(status);
  document.querySelectorAll('[data-action="cycle-reading-status"]').forEach((button) => {
    if (toId(button.dataset.id) === targetPaperId) {
      button.textContent = `阅读：${status}`;
      button.classList.remove("tone-pending", "tone-working", "tone-done");
      button.classList.add(`tone-${readingTone}`);
    }
  });
  const card = findCardByPaperId(targetPaperId);
  if (card) {
    const readingTag = card.querySelector("[data-role='reading-status']");
    if (readingTag) {
      readingTag.textContent = status;
      readingTag.classList.remove("tone-pending", "tone-working", "tone-done");
      readingTag.classList.add(`tone-${readingTone}`);
    }
  }
  const row = [...tableBody.querySelectorAll("tr[data-paper-id]")].find((item) => toId(item.dataset.paperId) === targetPaperId);
  if (row) {
    const cell = row.querySelector("[data-role='reading-status-cell']");
    if (cell) {
      cell.innerHTML = renderStatusChip(status, readingTone, "status-chip-compact");
    }
  }
}

async function fetchPapers() {
  const response = await fetch("/api/papers", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("加载论文数据失败");
  }
  if (expandedCardState) {
    await closeCardExpand({ immediate: true });
  }
  const payload = await response.json();
  papers = payload.papers || [];
  render();
}

async function updateReadingStatus(paper, nextStatus) {
  const previousStatus = paper.readingStatus || "待读";
  paper.readingStatus = nextStatus;
  syncReadingStatusUI(paper.id, nextStatus);
  if (readingStatusFilter.value === "all") {
    refreshStatsMetaAndTable();
  } else {
    render();
  }

  try {
    await patchPaperRecord(paper.id, { readingStatus: nextStatus });
    return true;
  } catch (_) {
    // fallback to rollback below
  }

  paper.readingStatus = previousStatus;
  syncReadingStatusUI(paper.id, previousStatus);
  if (readingStatusFilter.value === "all") {
    refreshStatsMetaAndTable();
  } else {
    render();
  }
  return false;
}

async function handleAction(event) {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.dataset.action;
  const targetPaperId = toId(target.dataset.id);

  if (action === "sort-summary") {
    const key = target.dataset.key;
    if (!key) {
      return;
    }
    if (summaryState.sortKey === key) {
      summaryState.sortDirection = summaryState.sortDirection === "asc" ? "desc" : "asc";
    } else {
      summaryState.sortKey = key;
      summaryState.sortDirection = ["title", "category", "venue", "aiStatus", "readingStatus"].includes(key) ? "asc" : "desc";
    }
    renderTable(filteredPapers());
    return;
  }

  if (action === "toggle-column-visibility") {
    const columnKey = String(target.dataset.columnKey || "");
    toggleSummaryColumnVisibility(columnKey);
    return;
  }

  if (action === "toggle-star") {
    if (!targetPaperId) {
      return;
    }
    const paper = papers.find((item) => toId(item.id) === targetPaperId);
    if (!paper) {
      return;
    }
    const previous = Boolean(paper.starred);
    const nextStarred = !previous;
    paper.starred = nextStarred;
    syncStarButtonsUI(targetPaperId, nextStarred);
    try {
      await patchPaperRecord(targetPaperId, { starred: nextStarred });
    } catch (error) {
      paper.starred = previous;
      syncStarButtonsUI(targetPaperId, previous);
      window.alert(error.message || "星标更新失败，请重试。");
    }
    return;
  }

  if (action === "summary-edit-row") {
    if (!targetPaperId) {
      return;
    }
    summaryState.selectedIds.clear();
    summaryState.selectedIds.add(targetPaperId);
    openInlineEditor(targetPaperId);
    return;
  }

  if (action === "summary-delete-row") {
    if (!targetPaperId) {
      return;
    }
    const confirmed = window.confirm("确认删除这条论文记录吗？该操作不可撤销。");
    if (!confirmed) {
      return;
    }
    await requestDeletePapers([targetPaperId]);
    summaryState.selectedIds.delete(targetPaperId);
    if (summaryState.editingPaperId === targetPaperId) {
      summaryState.editingPaperId = "";
    }
    await fetchPapers();
    return;
  }

  if (action === "summary-inline-cancel") {
    closeInlineEditor();
    return;
  }

  if (action === "open-reader") {
    event.preventDefault();
    event.stopPropagation();
    if (targetPaperId) {
      openReaderPage(targetPaperId, target.dataset.view || "original");
    }
    return;
  }

  if (action === "close-card-modal" || action === "close-card-expand") {
    await closeCardExpand({ duration: CARD_CLOSE_DURATION_MS });
    return;
  }

  const paper = papers.find((item) => toId(item.id) === targetPaperId);
  if (!paper) {
    return;
  }

  if (action === "open-card-expand") {
    await openCardExpand(paper, target.closest(".card"));
    return;
  }

  if (action === "copy-citation" && paper.citation) {
    navigator.clipboard.writeText(paper.citation).then(() => {
      const original = target.textContent;
      target.textContent = "已复制";
      window.setTimeout(() => {
        target.textContent = original;
      }, 1000);
    });
    return;
  }

  if (action === "cycle-reading-status") {
    const current = paper.readingStatus || "待读";
    const currentIndex = READING_STATUS_OPTIONS.indexOf(current);
    const nextStatus = READING_STATUS_OPTIONS[(currentIndex + 1) % READING_STATUS_OPTIONS.length];
    const reopenPaperId = expandedCardState?.paperId || null;
    if (reopenPaperId) {
      await closeCardExpand({ immediate: true });
    }
    const updated = await updateReadingStatus(paper, nextStatus);
    if (updated && reopenPaperId && toId(reopenPaperId) === toId(paper.id)) {
      const refreshed = papers.find((item) => item.id === paper.id);
      const refreshedCard = findCardByPaperId(paper.id);
      if (refreshed && refreshedCard) {
        await openCardExpand(refreshed, refreshedCard);
      }
    }
  }
}

function handleChange(event) {
  const target = event.target;
  if (!target) {
    return;
  }

  if (target.matches("[data-action='select-summary-row']")) {
    toggleSummaryRowSelection(target.dataset.id, target.checked);
    return;
  }

  if (target === summarySelectAll) {
    const visibleItems = getVisibleSortedItems();
    visibleItems.forEach((paper) => {
      const paperId = toId(paper.id);
      if (!paperId) {
        return;
      }
      if (target.checked) {
        summaryState.selectedIds.add(paperId);
      } else {
        summaryState.selectedIds.delete(paperId);
      }
    });
    renderTable(filteredPapers());
  }
}

function openEditForSingleSelection() {
  if (summaryState.selectedIds.size !== 1) {
    window.alert("请先勾选 1 篇论文后再编辑。");
    return;
  }
  const [paperId] = [...summaryState.selectedIds];
  openInlineEditor(paperId);
}

async function handleInlineEditSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.dataset.action !== "summary-inline-submit") {
    return;
  }
  event.preventDefault();
  const paperId = toId(form.dataset.id || "");
  if (!paperId) {
    return;
  }
  const formData = new FormData(form);
  const patch = {
    titleZh: String(formData.get("titleZh") || "").trim(),
    category: String(formData.get("category") || "").trim(),
    year: String(formData.get("year") || "").trim(),
    publishedAt: String(formData.get("publishedAt") || "").trim(),
    aiStatus: String(formData.get("aiStatus") || "待整理"),
    readingStatus: String(formData.get("readingStatus") || "待读"),
    venue: String(formData.get("venue") || "").trim(),
    doi: String(formData.get("doi") || "").trim(),
  };
  try {
    await patchPaperRecord(paperId, patch);
    await fetchPapers();
    summaryState.selectedIds.clear();
    summaryState.selectedIds.add(paperId);
    closeInlineEditor();
  } catch (error) {
    window.alert(error.message || "保存失败，请重试。");
  }
}

function connectEvents() {
  const source = new EventSource("/api/events");
  liveStatus.textContent = "实时同步已连接";
  liveStatus.classList.add("connected");
  liveStatus.classList.remove("disconnected");

  source.addEventListener("paper-updated", async (event) => {
    let paperId = "";
    try {
      const payload = JSON.parse(event.data || "{}");
      paperId = String(payload.paperId || "");
    } catch (_) {
      paperId = "";
    }
    if (paperId && consumeIfLocalPaperUpdate(paperId)) {
      return;
    }
    await fetchPapers();
  });
  source.onerror = () => {
    liveStatus.textContent = "实时连接断开，正在重连";
    liveStatus.classList.remove("connected");
    liveStatus.classList.add("disconnected");
  };
  source.onopen = () => {
    liveStatus.textContent = "实时同步已连接";
    liveStatus.classList.add("connected");
    liveStatus.classList.remove("disconnected");
  };
}

featureTabButtons.forEach((button) => {
  button.addEventListener("click", () => switchFeatureTab(button.dataset.featureTab));
});
window.addEventListener("resize", () => {
  scheduleMasonry();
  if (expandedCardState?.card) {
    setCardFixedRect(expandedCardState.card, getExpandedTargetRect());
  }
});
searchInput.addEventListener("input", render);
categoryFilter.addEventListener("change", render);
aiStatusFilter.addEventListener("change", render);
readingStatusFilter.addEventListener("change", render);
document.addEventListener("click", handleAction);
document.addEventListener("change", handleChange);
document.addEventListener("submit", handleInlineEditSubmit);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cardModal && !cardModal.hidden) {
    closeCardExpand({ duration: CARD_CLOSE_DURATION_MS });
  }
});
if (summaryEditSelectedBtn) {
  summaryEditSelectedBtn.addEventListener("click", openEditForSingleSelection);
}
if (summaryDeleteSelectedBtn) {
  summaryDeleteSelectedBtn.addEventListener("click", async () => {
    try {
      await requestDeleteSelectedPapers();
    } catch (error) {
      window.alert(error.message || "删除失败，请重试。");
    }
  });
}

syncStaticSelects();
renderSummaryColumnToggles();
applySummaryColumnVisibility();
switchFeatureTab(loadFeatureTab());
fetchPapers();
connectEvents();
