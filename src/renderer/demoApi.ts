import type { BrowserDashboard, CalendarDay, DashboardApi, DayDigest, TimelineItem } from "./types";

const demoVisits: TimelineItem[] = [
  {
    id: "demo-1",
    time: "2026-07-07T09:10:00.000Z",
    timeLabel: "09:10",
    domain: "github.com",
    title: "GitHub Pull Request Review",
    duration: 42 * 60 * 1000,
    durationText: "42 分钟 0 秒",
    rawDuration: 42 * 60 * 1000,
    rawDurationText: "42 分钟 0 秒",
    hasDuration: true,
    browser: "Chrome",
    profile: "Default"
  },
  {
    id: "demo-2",
    time: "2026-07-07T10:05:00.000Z",
    timeLabel: "10:05",
    domain: "react.dev",
    title: "React docs useEffect",
    duration: 28 * 60 * 1000,
    durationText: "28 分钟 0 秒",
    rawDuration: 28 * 60 * 1000,
    rawDurationText: "28 分钟 0 秒",
    hasDuration: true,
    browser: "Chrome",
    profile: "Default"
  },
  {
    id: "demo-3",
    time: "2026-07-07T11:25:00.000Z",
    timeLabel: "11:25",
    domain: "bank.example",
    title: "可能包含敏感信息的网页标题已隐藏",
    duration: 0,
    durationText: "0 秒",
    rawDuration: 0,
    rawDurationText: "0 秒",
    hasDuration: false,
    browser: "Edge",
    profile: "Default",
    sensitive: true
  }
];

function buildDemoDashboard(date: string): BrowserDashboard {
  return {
    date,
    generatedAt: new Date().toISOString(),
    totalDuration: 70 * 60 * 1000,
    totalDurationText: "1 小时 10 分钟",
    rawTotalDuration: 70 * 60 * 1000,
    rawTotalDurationText: "1 小时 10 分钟",
    cappedDurationCount: 0,
    visitCount: demoVisits.length,
    zeroDurationCount: 1,
    siteDurationRanking: [
      { domain: "github.com", duration: 42 * 60 * 1000, durationText: "42 分钟 0 秒", visitCount: 1, percentage: 60 },
      { domain: "react.dev", duration: 28 * 60 * 1000, durationText: "28 分钟 0 秒", visitCount: 1, percentage: 40 },
      { domain: "bank.example", duration: 0, durationText: "0 秒", visitCount: 1, percentage: 0 }
    ],
    pageDurationRanking: [
      { domain: "github.com", title: "GitHub Pull Request Review", duration: 42 * 60 * 1000, durationText: "42 分钟 0 秒", visitCount: 1, percentage: 60 },
      { domain: "react.dev", title: "React docs useEffect", duration: 28 * 60 * 1000, durationText: "28 分钟 0 秒", visitCount: 1, percentage: 40 },
      { domain: "bank.example", title: "可能包含敏感信息的网页标题已隐藏", duration: 0, durationText: "0 秒", visitCount: 1, percentage: 0, sensitive: true }
    ],
    siteVisitRanking: [
      { domain: "github.com", duration: 42 * 60 * 1000, durationText: "42 分钟 0 秒", visitCount: 1, percentage: 60 },
      { domain: "react.dev", duration: 28 * 60 * 1000, durationText: "28 分钟 0 秒", visitCount: 1, percentage: 40 },
      { domain: "bank.example", duration: 0, durationText: "0 秒", visitCount: 1, percentage: 0 }
    ],
    hourlyDuration: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}时`,
      duration: hour === 9 ? 42 * 60 * 1000 : hour === 10 ? 28 * 60 * 1000 : 0,
      durationText: hour === 9 ? "42 分钟 0 秒" : hour === 10 ? "28 分钟 0 秒" : "0 秒",
      visitCount: hour === 9 || hour === 10 || hour === 11 ? 1 : 0
    })),
    timeline: demoVisits,
    rawVisits: demoVisits,
    summary: `${date} 共读取 3 条浏览记录，有效浏览时长 1 小时 10 分钟。停留时间最高的网站是 github.com（42 分钟 0 秒）。单页占比最高的是《GitHub Pull Request Review》。浏览最集中的时段是 09时。另有 1 条记录没有原始时长。`
  };
}

function buildDigest(date: string): DayDigest {
  const dashboard = buildDemoDashboard(date);
  return {
    id: `demo-digest-${date}`,
    date,
    generatedAt: dashboard.generatedAt,
    dashboard,
    overview: dashboard.summary,
    stats: {
      visitCount: dashboard.visitCount,
      totalDuration: dashboard.totalDuration,
      zeroDurationCount: dashboard.zeroDurationCount
    }
  };
}

export function installDemoDashboardApi() {
  const api: DashboardApi = {
    getStore: async () => ({ demo: true }),
    scanBrowserHistory: async () => ({
      visits: demoVisits,
      availableBrowsers: ["Chrome Default", "Edge Default"],
      errors: []
    }),
    getMonth: async ({ year, month }) => {
      const last = new Date(year, month, 0);
      const markedDate = `${year}-${String(month).padStart(2, "0")}-07`;
      const days: CalendarDay[] = [];
      for (let day = 1; day <= last.getDate(); day += 1) {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        days.push({
          date,
          day,
          weekday: new Date(year, month - 1, day).getDay(),
          visitCount: date === markedDate ? demoVisits.length : 0,
          signalCount: date === markedDate ? demoVisits.length : 0
        });
      }
      return days;
    },
    getDay: async (date) => ({ digest: buildDigest(date) })
  };

  window.dashboardApi = api;
}
