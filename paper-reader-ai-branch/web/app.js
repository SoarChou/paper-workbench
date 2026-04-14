let papers = [];

const searchInput = document.querySelector("#searchInput");
const categoryFilter = document.querySelector("#categoryFilter");
const aiStatusFilter = document.querySelector("#aiStatusFilter");
const readingStatusFilter = document.querySelector("#readingStatusFilter");
const statsContainer = document.querySelector("#stats");
const cardsContainer = document.querySelector("#cards");
const tableBody = document.querySelector("#tableBody");
const resultMeta = document.querySelector("#resultMeta");
const liveStatus = document.querySelector("#liveStatus");
const featureTabButtons = document.querySelectorAll("[data-feature-tab]");
const featurePanels = document.querySelectorAll("[data-feature-panel]");

const draftForm = document.querySelector("#draftForm");
const draftFeedback = document.querySelector("#draftFeedback");
const paperSelect = document.querySelector("#paperSelect");
const newDraftBtn = document.querySelector("#newDraftBtn");
const paperIdInput = document.querySelector("#paperId");
const paperTitleInput = document.querySelector("#paperTitle");
const paperYearInput = document.querySelector("#paperYear");
const paperCategoryInput = document.querySelector("#paperCategory");
const paperAuthorsInput = document.querySelector("#paperAuthors");
const paperVenueInput = document.querySelector("#paperVenue");
const paperAiStatusInput = document.querySelector("#paperAiStatus");
const paperReadingStatusInput = document.querySelector("#paperReadingStatus");
const paperSummaryInput = document.querySelector("#paperSummary");
const paperTakeawaysInput = document.querySelector("#paperTakeaways");
const paperFocusInput = document.querySelector("#paperFocus");
const paperCitationInput = document.querySelector("#paperCitation");
const paperDoiInput = document.querySelector("#paperDoi");
const paperOriginalUrlInput = document.querySelector("#paperOriginalUrl");
const paperTranslationInput = document.querySelector("#paperTranslation");
const paperNotesInput = document.querySelector("#paperNotes");

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function switchFeatureTab(tab) {
  featureTabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.featureTab === tab);
  });
  featurePanels.forEach((panel) => {
    const active = panel.dataset.featurePanel === tab;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
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
    { label: "总论文", value: papers.length, hint: "当前库内" },
    { label: "当前结果", value: items.length, hint: "符合筛选" },
    { label: "待AI处理", value: aiPending, hint: "可直接让我补全" },
    { label: "在读 / 完成", value: `${reading} / ${done}`, hint: "阅读 / AI状态" },
  ];

  statsContainer.innerHTML = stats.map((stat) => `
    <article class="stat">
      <span>${stat.label}</span>
      <strong>${stat.value}</strong>
      <span>${stat.hint}</span>
    </article>
  `).join("");
}

function renderCards(items) {
  if (!items.length) {
    cardsContainer.innerHTML = `<div class="empty">没有匹配的论文，换个条件试试。</div>`;
    return;
  }

  cardsContainer.innerHTML = items.map((paper) => `
    <article class="card">
      <div class="card-top">
        <div>
          <h3>${paper.titleZh || paper.title}</h3>
          <p class="meta">${paper.title}</p>
          <p class="meta">${[paper.authors, paper.venue].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <div class="tags">
        <span class="tag">${paper.category || "未分类"}</span>
        <span class="tag">${paper.year || "-"}</span>
        <span class="tag">${paper.aiStatus || "待AI整理"}</span>
        <span class="tag">${paper.readingStatus || "待读"}</span>
      </div>
      <p class="card-summary">${paper.summary || "待补充摘要。"}</p>
      ${(paper.takeaways || []).length ? `<ul class="detail-list">${paper.takeaways.map((item) => `<li>${item}</li>`).join("")}</ul>` : ""}
      <div class="card-actions">
        ${(paper.original || paper.originalUrl) ? `<a class="mini-btn" href="${paper.original || paper.originalUrl}" target="_blank" rel="noreferrer">打开原文</a>` : ""}
        ${paper.translation ? `<a class="mini-btn" href="${paper.translation}" target="_blank" rel="noreferrer">打开翻译</a>` : ""}
        ${paper.notes ? `<a class="mini-btn" href="${paper.notes}" target="_blank" rel="noreferrer">打开笔记</a>` : ""}
        ${paper.citation ? `<button class="mini-btn" data-action="copy-citation" data-id="${paper.id}" type="button">复制引用</button>` : ""}
        <select class="status-select" data-action="change-reading-status" data-id="${paper.id}">
          ${["待读", "在读", "已读"].map((status) => `<option value="${status}" ${paper.readingStatus === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </div>
    </article>
  `).join("");
}

function renderTable(items) {
  tableBody.innerHTML = items.map((paper) => `
    <tr>
      <td><strong>${paper.titleZh || paper.title}</strong><br /><span class="meta">${paper.title}</span></td>
      <td>${paper.category || ""}</td>
      <td>${paper.year || ""}</td>
      <td>${paper.aiStatus || "待AI整理"}</td>
      <td>${paper.readingStatus || "待读"}</td>
      <td>${paper.venue || ""}</td>
    </tr>
  `).join("");
}

function renderSelect() {
  const current = paperSelect.value;
  paperSelect.innerHTML = `<option value="">新建条目</option>${papers.map((paper) => `<option value="${paper.id}">${paper.titleZh || paper.title}</option>`).join("")}`;
  if ([...paperSelect.options].some((option) => option.value === current)) {
    paperSelect.value = current;
  }
}

function render() {
  const items = filteredPapers();
  const categories = [...new Set(papers.map((paper) => paper.category).filter(Boolean))];
  const currentCategory = categoryFilter.value;
  categoryFilter.innerHTML = `<option value="all">全部分类</option>${categories.map((category) => `<option value="${category}">${category}</option>`).join("")}`;
  if ([...categoryFilter.options].some((option) => option.value === currentCategory)) {
    categoryFilter.value = currentCategory;
  }
  renderStats(items);
  renderCards(items);
  renderTable(items);
  renderSelect();
  resultMeta.textContent = `共 ${items.length} 篇结果`;
}

async function fetchPapers() {
  const response = await fetch("/api/papers", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("加载论文数据失败");
  }
  const payload = await response.json();
  papers = payload.papers || [];
  render();
}

function clearForm() {
  draftForm.reset();
  paperIdInput.value = "";
  paperSelect.value = "";
  draftFeedback.textContent = "建议：先上传原文建草稿，再直接让我生成摘要 / 翻译 / 笔记。";
  draftFeedback.className = "form-feedback";
}

function fillForm(paperId) {
  if (!paperId) {
    clearForm();
    return;
  }
  const paper = papers.find((item) => item.id === paperId);
  if (!paper) {
    return;
  }
  paperIdInput.value = paper.id || "";
  paperTitleInput.value = paper.title || "";
  paperYearInput.value = paper.year || "";
  paperCategoryInput.value = paper.category || "";
  paperAuthorsInput.value = paper.authors || "";
  paperVenueInput.value = paper.venue || "";
  paperAiStatusInput.value = paper.aiStatus || "待AI整理";
  paperReadingStatusInput.value = paper.readingStatus || "待读";
  paperSummaryInput.value = paper.summary || "";
  paperTakeawaysInput.value = (paper.takeaways || []).join("\n");
  paperFocusInput.value = paper.focus || "";
  paperCitationInput.value = paper.citation || "";
  paperDoiInput.value = paper.doi || "";
  paperOriginalUrlInput.value = paper.originalUrl || "";
  paperTranslationInput.value = "";
  paperNotesInput.value = "";
  draftFeedback.textContent = `正在编辑：${paper.titleZh || paper.title}`;
  draftFeedback.className = "form-feedback success";
}

async function submitDraft(event) {
  event.preventDefault();
  draftFeedback.textContent = "正在保存条目…";
  draftFeedback.className = "form-feedback";
  const formData = new FormData(draftForm);
  try {
    const response = await fetch("/api/papers", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "保存失败");
    }
    draftFeedback.textContent = `保存成功：${payload.paperId}`;
    draftFeedback.className = "form-feedback success";
    await fetchPapers();
    paperSelect.value = payload.paperId;
    fillForm(payload.paperId);
  } catch (error) {
    draftFeedback.textContent = error.message || "保存失败";
    draftFeedback.className = "form-feedback error";
  }
}

function handleAction(event) {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }
  const paper = papers.find((item) => item.id === target.dataset.id);
  if (!paper) {
    return;
  }

  if (target.dataset.action === "copy-citation" && paper.citation) {
    navigator.clipboard.writeText(paper.citation).then(() => {
      const original = target.textContent;
      target.textContent = "已复制";
      window.setTimeout(() => { target.textContent = original; }, 1000);
    });
  }
}

async function handleChange(event) {
  const target = event.target;
  if (target.dataset.action === "change-reading-status") {
    const paper = papers.find((item) => item.id === target.dataset.id);
    if (!paper) {
      return;
    }
    const formData = new FormData();
    formData.append("paperId", paper.id);
    formData.append("title", paper.title);
    formData.append("titleZh", paper.titleZh || "");
    formData.append("authors", paper.authors || "");
    formData.append("venue", paper.venue || "");
    formData.append("doi", paper.doi || "");
    formData.append("year", paper.year || "");
    formData.append("category", paper.category || "");
    formData.append("summary", paper.summary || "");
    formData.append("takeaways", (paper.takeaways || []).join("\n"));
    formData.append("citation", paper.citation || "");
    formData.append("focus", paper.focus || "");
    formData.append("aiStatus", paper.aiStatus || "待AI整理");
    formData.append("readingStatus", target.value);
    formData.append("originalUrl", paper.originalUrl || "");
    const response = await fetch("/api/papers", { method: "POST", body: formData });
    if (response.ok) {
      await fetchPapers();
    }
  }
}

function connectEvents() {
  const source = new EventSource("/api/events");
  liveStatus.textContent = "实时同步已连接";
  liveStatus.classList.add("connected");
  liveStatus.classList.remove("disconnected");

  source.addEventListener("paper-updated", async () => {
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
searchInput.addEventListener("input", render);
categoryFilter.addEventListener("change", render);
aiStatusFilter.addEventListener("change", render);
readingStatusFilter.addEventListener("change", render);
paperSelect.addEventListener("change", () => fillForm(paperSelect.value));
newDraftBtn.addEventListener("click", clearForm);
draftForm.addEventListener("submit", submitDraft);
document.addEventListener("click", handleAction);
document.addEventListener("change", handleChange);

fetchPapers();
connectEvents();
