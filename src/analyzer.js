const SENSITIVE_TERMS = [
  "password",
  "login",
  "account",
  "bank",
  "medical",
  "doctor",
  "auth",
  "token",
  "密码",
  "登录",
  "账户",
  "银行",
  "医院",
  "医生",
  "病历",
  "支付"
];

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function localDateString(value) {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function sameLocalDate(value, yyyyMmDd) {
  return localDateString(value) === yyyyMmDd;
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeVisit(item) {
  return {
    id: item.id || `visit-${item.visitTime || item.lastVisitTime || item.url}`,
    visitTime: item.visitTime || item.lastVisitTime,
    title: item.title || "",
    domain: item.domain || domainFromUrl(item.url || ""),
    url: item.url || "",
    visitDuration: Number(item.visitDuration || 0),
    transition: item.transition || "",
    browser: item.browser || "",
    profile: item.profile || ""
  };
}

function normalizeText(...parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function isSensitive(item) {
  const text = normalizeText(item.title, item.url, item.domain);
  return SENSITIVE_TERMS.some((term) => text.includes(term.toLowerCase()));
}

function safeTitle(item) {
  if (isSensitive(item)) return "可能包含敏感信息的网页标题已隐藏";
  return item.title || item.domain || "未命名网页";
}

function durationMs(value) {
  return Math.max(0, Number(value || 0) / 1000);
}

function formatDuration(ms) {
  if (!ms) return "0 秒";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes) return `${minutes} 分钟 ${seconds} 秒`;
  return `${seconds} 秒`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(toDate(value));
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function makePageKey(visit) {
  return `${visit.title || "未命名网页"}|${visit.domain || ""}|${visit.url || ""}`;
}

function sortRanking(items) {
  return items.sort((a, b) => {
    if (b.duration !== a.duration) return b.duration - a.duration;
    return b.visitCount - a.visitCount;
  });
}

function buildBrowserDashboard({ date, browserVisits = [] }) {
  const visits = browserVisits
    .map(normalizeVisit)
    .filter((visit) => visit.visitTime && sameLocalDate(visit.visitTime, date))
    .sort((a, b) => toDate(a.visitTime) - toDate(b.visitTime));

  const totalDuration = visits.reduce((sum, visit) => sum + durationMs(visit.visitDuration), 0);
  const siteMap = new Map();
  const pageMap = new Map();

  visits.forEach((visit) => {
    const visitDuration = durationMs(visit.visitDuration);
    const siteKey = visit.domain || "未知网站";
    const pageKey = makePageKey(visit);

    if (!siteMap.has(siteKey)) {
      siteMap.set(siteKey, {
        domain: siteKey,
        duration: 0,
        durationText: "",
        visitCount: 0,
        percentage: 0
      });
    }
    const site = siteMap.get(siteKey);
    site.duration += visitDuration;
    site.visitCount += 1;

    if (!pageMap.has(pageKey)) {
      pageMap.set(pageKey, {
        title: safeTitle(visit),
        domain: siteKey,
        duration: 0,
        durationText: "",
        visitCount: 0,
        percentage: 0,
        sensitive: isSensitive(visit)
      });
    }
    const page = pageMap.get(pageKey);
    page.duration += visitDuration;
    page.visitCount += 1;
  });

  const siteDurationRanking = sortRanking(Array.from(siteMap.values()))
    .map((item) => ({
      ...item,
      durationText: formatDuration(item.duration),
      percentage: percent(item.duration, totalDuration)
    }))
    .slice(0, 12);

  const pageDurationRanking = sortRanking(Array.from(pageMap.values()))
    .map((item) => ({
      ...item,
      durationText: formatDuration(item.duration),
      percentage: percent(item.duration, totalDuration)
    }))
    .slice(0, 12);

  const siteVisitRanking = Array.from(siteMap.values())
    .sort((a, b) => b.visitCount - a.visitCount || b.duration - a.duration)
    .map((item) => ({
      domain: item.domain,
      visitCount: item.visitCount,
      duration: item.duration,
      durationText: formatDuration(item.duration),
      percentage: percent(item.duration, totalDuration)
    }))
    .slice(0, 12);

  const timeline = visits.map((visit) => ({
    id: visit.id,
    time: visit.visitTime,
    timeLabel: formatTime(visit.visitTime),
    domain: visit.domain || "未知网站",
    title: safeTitle(visit),
    duration: durationMs(visit.visitDuration),
    durationText: formatDuration(durationMs(visit.visitDuration)),
    hasDuration: durationMs(visit.visitDuration) > 0,
    browser: visit.browser,
    profile: visit.profile,
    sensitive: isSensitive(visit)
  }));

  const rawVisits = visits.map((visit) => ({
    id: visit.id,
    visitTime: visit.visitTime,
    timeLabel: formatTime(visit.visitTime),
    title: safeTitle(visit),
    domain: visit.domain || "未知网站",
    duration: durationMs(visit.visitDuration),
    durationText: formatDuration(durationMs(visit.visitDuration)),
    transition: visit.transition,
    browser: visit.browser,
    profile: visit.profile,
    sensitive: isSensitive(visit)
  }));

  const topSite = siteDurationRanking[0];
  const topPage = pageDurationRanking[0];
  const zeroDurationCount = visits.filter((visit) => durationMs(visit.visitDuration) === 0).length;
  const summary = visits.length
    ? `${date} 共读取 ${visits.length} 条浏览记录，Chrome 原始时长合计 ${formatDuration(totalDuration)}。${topSite ? `时长最高的网站是 ${topSite.domain}（${topSite.durationText}）。` : ""}${topPage ? `单页占比最高的是「${topPage.title}」。` : ""}${zeroDurationCount ? `另有 ${zeroDurationCount} 条记录没有原始时长。` : ""}`
    : `${date} 暂无浏览记录。`;

  return {
    date,
    generatedAt: new Date().toISOString(),
    totalDuration,
    totalDurationText: formatDuration(totalDuration),
    visitCount: visits.length,
    zeroDurationCount,
    siteDurationRanking,
    pageDurationRanking,
    siteVisitRanking,
    timeline,
    rawVisits,
    summary
  };
}

function createDayDigest({ date, browserVisits = [] }) {
  const dashboard = buildBrowserDashboard({ date, browserVisits });
  return {
    id: `digest-${date}`,
    date,
    generatedAt: new Date().toISOString(),
    dashboard,
    overview: dashboard.summary,
    stats: {
      visitCount: dashboard.visitCount,
      totalDuration: dashboard.totalDuration,
      zeroDurationCount: dashboard.zeroDurationCount
    }
  };
}

function buildCalendarDays({ year, month, browserVisits = [] }) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const days = [];
  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = [
      first.getFullYear(),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0")
    ].join("-");
    const visitCount = browserVisits.filter((visit) => sameLocalDate(visit.visitTime || visit.lastVisitTime, date)).length;
    days.push({
      date,
      day,
      weekday: new Date(year, month - 1, day).getDay(),
      visitCount,
      signalCount: visitCount
    });
  }
  return days;
}

module.exports = {
  buildBrowserDashboard,
  createDayDigest,
  buildCalendarDays,
  formatDuration,
  isSensitive,
  safeTitle,
  sameLocalDate
};
