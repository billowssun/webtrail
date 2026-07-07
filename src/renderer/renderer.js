const state = {
  store: null,
  selectedDate: todayIso(),
  visibleYear: new Date().getFullYear(),
  visibleMonth: new Date().getMonth() + 1,
  monthDays: [],
  digest: null,
  activeView: "sites"
};

const els = {
  dateInput: document.querySelector("#dateInput"),
  scanHistoryButton: document.querySelector("#scanHistoryButton"),
  generateButton: document.querySelector("#generateButton"),
  statusBanner: document.querySelector("#statusBanner"),
  prevMonthButton: document.querySelector("#prevMonthButton"),
  nextMonthButton: document.querySelector("#nextMonthButton"),
  monthTitle: document.querySelector("#monthTitle"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarDayTemplate: document.querySelector("#calendarDayTemplate"),
  dayTitle: document.querySelector("#dayTitle"),
  totalDurationText: document.querySelector("#totalDurationText"),
  visitCountText: document.querySelector("#visitCountText"),
  zeroDurationText: document.querySelector("#zeroDurationText"),
  viewButtons: Array.from(document.querySelectorAll(".view-button")),
  viewPanel: document.querySelector("#viewPanel")
};

function todayIso() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function setStatus(message, tone = "info") {
  els.statusBanner.textContent = message;
  els.statusBanner.dataset.tone = tone;
}

function formatMonthTitle(year, month) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(new Date(year, month - 1, 1));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadStore() {
  state.store = await window.dashboardApi.getStore();
}

async function loadMonth() {
  state.monthDays = await window.dashboardApi.getMonth({
    year: state.visibleYear,
    month: state.visibleMonth
  });
  renderCalendar();
}

async function loadDay(date) {
  state.selectedDate = date;
  els.dateInput.value = date;
  const [year, month] = date.split("-").map(Number);
  if (year !== state.visibleYear || month !== state.visibleMonth) {
    state.visibleYear = year;
    state.visibleMonth = month;
    await loadMonth();
  }
  const result = await window.dashboardApi.getDay(date);
  state.digest = result.digest;
  renderCalendar();
  renderDay();
}

function renderCalendar() {
  els.monthTitle.textContent = formatMonthTitle(state.visibleYear, state.visibleMonth);
  els.calendarGrid.innerHTML = "";

  const firstWeekday = new Date(state.visibleYear, state.visibleMonth - 1, 1).getDay();
  for (let index = 0; index < firstWeekday; index += 1) {
    const spacer = document.createElement("div");
    spacer.className = "calendar-spacer";
    els.calendarGrid.appendChild(spacer);
  }

  state.monthDays.forEach((day) => {
    const fragment = els.calendarDayTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".calendar-day");
    fragment.querySelector(".day-number").textContent = day.day;
    fragment.querySelector(".day-mark").textContent = day.signalCount ? "有记录" : "";
    button.dataset.selected = String(day.date === state.selectedDate);
    button.dataset.hasSignal = String(day.signalCount > 0);
    button.title = `${day.date}，${day.visitCount} 条浏览记录`;
    button.addEventListener("click", () => loadDay(day.date));
    els.calendarGrid.appendChild(fragment);
  });
}

function renderDay() {
  const dashboard = state.digest.dashboard;
  els.dayTitle.textContent = state.selectedDate;
  els.totalDurationText.textContent = dashboard.totalDurationText;
  els.visitCountText.textContent = `${dashboard.visitCount} 条浏览记录`;
  els.zeroDurationText.textContent = `${dashboard.zeroDurationCount} 条无时长记录`;
  renderViewButtons();
  renderActiveView();
}

function renderViewButtons() {
  els.viewButtons.forEach((button) => {
    button.dataset.active = String(button.dataset.view === state.activeView);
  });
}

function renderActiveView() {
  const dashboard = state.digest.dashboard;
  const renderers = {
    sites: () => renderDurationBars("网站浏览时长", dashboard.siteDurationRanking, {
      label: (item) => item.domain,
      sub: (item) => `${item.visitCount} 次访问 · 占总时长 ${item.percentage}%`,
      value: (item) => item.durationText,
      percent: (item) => item.percentage
    }),
    pages: () => renderDurationBars("单网页占比", dashboard.pageDurationRanking, {
      label: (item) => item.title,
      sub: (item) => `${item.domain} · ${item.visitCount} 次访问`,
      value: (item) => `${item.durationText} · ${item.percentage}%`,
      percent: (item) => item.percentage
    }),
    visits: () => renderVisitColumns(dashboard.siteVisitRanking),
    timeline: () => renderTimeline(dashboard.timeline),
    raw: () => renderRawTable(dashboard.rawVisits)
  };
  els.viewPanel.innerHTML = renderers[state.activeView]();
}

function emptyView(title, text) {
  return `<div class="visual-card"><h3>${title}</h3><p class="muted">${text}</p></div>`;
}

function renderDurationBars(title, items, config) {
  if (!items.length) return emptyView(title, "暂无可展示的数据。");
  const rows = items.map((item, index) => {
    const width = Math.max(2, Math.min(100, config.percent(item)));
    return `
      <article class="bar-row">
        <span class="rank">${index + 1}</span>
        <div class="bar-main">
          <div class="bar-head">
            <strong>${escapeHtml(config.label(item))}</strong>
            <span>${escapeHtml(config.value(item))}</span>
          </div>
          <div class="bar-track"><span style="width:${width}%"></span></div>
          <small>${escapeHtml(config.sub(item))}</small>
        </div>
      </article>
    `;
  }).join("");
  return `<div class="visual-card"><h3>${title}</h3><div class="bar-list">${rows}</div></div>`;
}

function renderVisitColumns(items) {
  if (!items.length) return emptyView("网站访问次数", "暂无可展示的数据。");
  const max = Math.max(...items.map((item) => item.visitCount), 1);
  const bars = items.slice(0, 12).map((item) => {
    const height = Math.max(8, Math.round((item.visitCount / max) * 160));
    return `
      <article class="column-item">
        <div class="column-bar" style="height:${height}px"><span>${item.visitCount}</span></div>
        <strong title="${escapeHtml(item.domain)}">${escapeHtml(item.domain)}</strong>
        <small>${escapeHtml(item.durationText)}</small>
      </article>
    `;
  }).join("");
  return `<div class="visual-card"><h3>网站访问次数</h3><div class="column-chart">${bars}</div></div>`;
}

function renderTimeline(items) {
  if (!items.length) return emptyView("时间线网页", "暂无可展示的数据。");
  const rows = items.slice(0, 180).map((item) => `
    <article class="timeline-row">
      <time>${escapeHtml(item.timeLabel)}</time>
      <span class="timeline-dot"></span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.domain)} · ${escapeHtml(item.hasDuration ? item.durationText : "无时长记录")}</small>
      </div>
    </article>
  `).join("");
  return `<div class="visual-card"><h3>时间线网页</h3><div class="timeline-visual">${rows}</div></div>`;
}

function renderRawTable(items) {
  if (!items.length) return emptyView("原始访问明细", "暂无可展示的数据。");
  const rows = items.slice(0, 260).map((item) => `
    <tr>
      <td>${escapeHtml(item.timeLabel)}</td>
      <td>${escapeHtml(item.domain)}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.durationText)}</td>
      <td>${escapeHtml(item.browser || "浏览器")}</td>
    </tr>
  `).join("");
  return `
    <div class="visual-card">
      <h3>原始访问明细</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>网站</th><th>标题</th><th>时长</th><th>来源</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

els.scanHistoryButton.addEventListener("click", async () => {
  setStatus("正在读取浏览器访问记录...", "info");
  try {
    const result = await window.dashboardApi.scanBrowserHistory(state.selectedDate);
    const errors = result.errors.length ? `；部分失败：${result.errors.join("；")}` : "";
    setStatus(`读取完成，共 ${result.visits.length} 条浏览记录${errors}`, result.errors.length ? "warn" : "success");
    await loadStore();
    await loadMonth();
    await loadDay(state.selectedDate);
  } catch (error) {
    setStatus(`读取失败：${error.message}`, "error");
  }
});

els.generateButton.addEventListener("click", async () => {
  setStatus("正在刷新浏览行为看板...", "info");
  try {
    const result = await window.dashboardApi.getDay(state.selectedDate);
    state.digest = result.digest;
    renderDay();
    await loadMonth();
    setStatus("看板已刷新。", "success");
  } catch (error) {
    setStatus(`刷新失败：${error.message}`, "error");
  }
});

els.viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeView = button.dataset.view;
    renderViewButtons();
    renderActiveView();
  });
});

els.prevMonthButton.addEventListener("click", async () => {
  const date = new Date(state.visibleYear, state.visibleMonth - 2, 1);
  state.visibleYear = date.getFullYear();
  state.visibleMonth = date.getMonth() + 1;
  await loadMonth();
});

els.nextMonthButton.addEventListener("click", async () => {
  const date = new Date(state.visibleYear, state.visibleMonth, 1);
  state.visibleYear = date.getFullYear();
  state.visibleMonth = date.getMonth() + 1;
  await loadMonth();
});

els.dateInput.addEventListener("change", () => loadDay(els.dateInput.value));

async function init() {
  els.dateInput.value = state.selectedDate;
  await loadStore();
  await loadMonth();
  await loadDay(state.selectedDate);
  setStatus("就绪。读取浏览记录后，用按钮切换不同看板。", "info");
}

init().catch((error) => setStatus(`启动失败：${error.message}`, "error"));
