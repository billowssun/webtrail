import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EChartsCoreOption as EChartsOption } from "echarts/core";
import {
  ArrowSquareOut, CalendarBlank, CaretDown, CaretLeft, CaretRight, CaretUp,
  ChartBar, Check, Clock, ClockCounterClockwise, DownloadSimple, Export,
  Funnel, Globe, MagnifyingGlass, Moon, Rows, ShieldCheck, Sun, Trash
} from "@phosphor-icons/react";
import Chart from "./Chart";
import {
  downloadBlob, ensureDemoArchive, faviconUrl, getArchiveStats, getArchiveStatus,
  isExtension, queryVisits, sendExtensionMessage, type ArchivedVisit, type ArchiveStatus
} from "./archiveDb";
import { buildSessions, domainRanking, formatSpan, formatTime, type VisitSession } from "./historyModel";
import {
  DAY, dayStart, localDate, percentChange, shiftDate, sourceGroup, type SourceGroup
} from "./visualizationModel";

type ViewKey = "analysis" | "history";
type Theme = "light" | "dark";
type PeriodMode = "day" | "week" | "month";
type DatePreset = "today" | "yesterday" | "week" | "month" | "all" | "custom";
type Stats = { count: number; oldest: number | null; newest: number | null; usage: number; quota: number };
type Bucket = { key: string; label: string; count: number; start: number; end: number };

const TODAY = localDate(Date.now());
const ACCENT = "#1769e8";
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const SOURCE_TYPES: SourceGroup[] = ["直接访问", "链接跳转", "搜索与关键词", "重新加载", "其他"];

function compact(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

function fullDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short"
  }).format(new Date(`${value}T12:00:00`));
}

function shortDay(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return `${year}年${month}月`;
}

function calendarCells(month: string) {
  const [year, value] = month.split("-").map(Number);
  const first = new Date(year, value - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, value - 1, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date: localDate(date), day: date.getDate(), current: date.getMonth() === value - 1 };
  });
}

function periodBounds(mode: PeriodMode, selectedDate: string) {
  const selected = new Date(`${selectedDate}T12:00:00`);
  if (mode === "day") {
    const start = dayStart(selectedDate);
    return { start, end: start + DAY };
  }
  if (mode === "week") {
    const offset = (selected.getDay() + 6) % 7;
    const monday = shiftDate(selectedDate, -offset);
    return { start: dayStart(monday), end: dayStart(monday) + 7 * DAY };
  }
  const start = new Date(selected.getFullYear(), selected.getMonth(), 1).getTime();
  return { start, end: new Date(selected.getFullYear(), selected.getMonth() + 1, 1).getTime() };
}

function periodLabel(mode: PeriodMode, selectedDate: string) {
  const bounds = periodBounds(mode, selectedDate);
  if (mode === "day") return fullDate(selectedDate);
  if (mode === "week") return `${shortDay(localDate(bounds.start))} — ${shortDay(localDate(bounds.end - DAY))}`;
  return monthLabel(selectedDate.slice(0, 7));
}

function trendPeriodLabel(mode: PeriodMode, selectedDate: string) {
  const label = periodLabel(mode, selectedDate);
  if (mode === "day") return `${label} · 按小时`;
  if (mode === "week") return `${label} · 按天`;
  return `${label} · 按日`;
}

function periodBuckets(mode: PeriodMode, selectedDate: string, visits: ArchivedVisit[]) {
  const bounds = periodBounds(mode, selectedDate);
  const makeBucket = (key: string, label: string, start: number, end: number): Bucket => ({
    key, label, start, end,
    count: visits.filter((visit) => visit.visitTime >= start && visit.visitTime < end).length
  });
  if (mode === "day") {
    return Array.from({ length: 24 }, (_, index) => {
      const start = bounds.start + index * 60 * 60 * 1000;
      return makeBucket(String(index), `${String(index).padStart(2, "0")}:00`, start, start + 60 * 60 * 1000);
    });
  }
  if (mode === "week") {
    return Array.from({ length: 7 }, (_, index) => {
      const start = bounds.start + index * DAY;
      return makeBucket(String(index), `周${WEEKDAYS[index]}`, start, start + DAY);
    });
  }
  const days = Math.round((bounds.end - bounds.start) / DAY);
  return Array.from({ length: days }, (_, index) => {
    const start = bounds.start + index * DAY;
    return makeBucket(String(index), String(index + 1), start, start + DAY);
  });
}

function comparisonVisits(mode: PeriodMode, selectedDate: string, visits: ArchivedVisit[]) {
  const bounds = periodBounds(mode, selectedDate);
  const duration = bounds.end - bounds.start;
  return visits.filter((visit) => visit.visitTime >= bounds.start - duration && visit.visitTime < bounds.start);
}

function contributionModel(visits: ArchivedVisit[], selectedDate: string, mode: PeriodMode) {
  const windowDays = mode === "day" ? 84 : mode === "week" ? 182 : 365;
  const end = dayStart(selectedDate) + DAY;
  const rawStart = end - windowDays * DAY;
  const rawDate = new Date(rawStart);
  const offset = (rawDate.getDay() + 6) % 7;
  const start = rawStart - offset * DAY;
  const counts = new Map<string, number>();
  visits.forEach((visit) => {
    if (visit.visitTime < start || visit.visitTime >= end) return;
    const key = localDate(visit.visitTime);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const weeks = Math.ceil((end - start) / (7 * DAY));
  const data: Array<{ value: [number, number, number]; date: string }> = [];
  const labels = Array.from({ length: weeks }, () => "");
  for (let week = 0; week < weeks; week += 1) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const time = start + (week * 7 + weekday) * DAY;
      if (time >= end) continue;
      const date = localDate(time);
      data.push({ value: [week, weekday, counts.get(date) || 0], date });
      const day = new Date(time);
      if (day.getDate() <= 7 && !labels[week]) labels[week] = `${day.getMonth() + 1}月`;
    }
  }
  return {
    data, labels,
    max: Math.max(...data.map((item) => item.value[2]), 1),
    subtitle: mode === "day" ? "近 12 周" : mode === "week" ? "近 26 周" : "近 12 个月"
  };
}

function sourceText(value: string) {
  return sourceGroup(value);
}

function csvFor(visits: ArchivedVisit[]) {
  const rows = [["时间", "标题", "URL", "域名", "导航类型"]]
    .concat(visits.map((visit) => [
      new Date(visit.visitTime).toISOString(), visit.title, visit.url, visit.domain, sourceText(visit.transition)
    ]));
  return `\uFEFF${rows.map((row) =>
    row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")
  ).join("\r\n")}`;
}

export default function App() {
  const [view, setView] = useState<ViewKey>("analysis");
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("webtrail-theme") as Theme | null;
    return saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  });
  const [mode, setMode] = useState<PeriodMode>("day");
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [calendarMonth, setCalendarMonth] = useState(TODAY.slice(0, 7));
  const [visits, setVisits] = useState<ArchivedVisit[]>([]);
  const [stats, setStats] = useState<Stats>({ count: 0, oldest: null, newest: null, usage: 0, quota: 0 });
  const [status, setStatus] = useState<ArchiveStatus>({ phase: "idle" });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState("");
  const demoDateAdjusted = useRef(false);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("webtrail-theme", theme);
  }, [theme]);

  useEffect(() => {
    void ensureDemoArchive().then(refresh);
    if (!isExtension) return;
    const listener = (message: { type?: string; status?: ArchiveStatus }) => {
      if (message.type === "ARCHIVE_CHANGED") refresh();
      if (message.type === "ARCHIVE_STATUS_CHANGED" && message.status) setStatus(message.status);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [nextVisits, nextStats, nextStatus] = await Promise.all([
          queryVisits({ startTime: 0, endTime: Date.now() + DAY, limit: 200_000 }),
          getArchiveStats(),
          getArchiveStatus()
        ]);
        if (cancelled) return;
        setVisits(nextVisits);
        setStats(nextStats);
        setStatus(nextStatus);
        if (!isExtension && !demoDateAdjusted.current && nextStats.newest && !nextVisits.some((visit) => localDate(visit.visitTime) === TODAY)) {
          const latest = localDate(nextStats.newest);
          demoDateAdjusted.current = true;
          setSelectedDate(latest);
          setCalendarMonth(latest.slice(0, 7));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const chooseDate = (date: string) => {
    setSelectedDate(date);
    setCalendarMonth(date.slice(0, 7));
  };

  const exportVisits = (source: ArchivedVisit[]) => {
    downloadBlob(csvFor(source), `webtrail-${localDate(Date.now())}.csv`, "text/csv;charset=utf-8");
    setToast(`已导出 ${source.length} 条记录`);
  };

  return <div className="app-shell">
    <Sidebar view={view} setView={setView} status={status} />
    <div className="app-main">
      <Topbar
        view={view} query={query} setQuery={setQuery}
        onSearch={() => setView("history")}
        theme={theme} toggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
        onExport={() => exportVisits(visits)}
      />
      {toast ? <button className="toast" onClick={() => setToast("")}><ShieldCheck weight="fill" />{toast}</button> : null}
      {view === "analysis" ? (
        <AnalysisPage
          theme={theme} mode={mode} setMode={setMode} selectedDate={selectedDate}
          calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth}
          visits={visits} chooseDate={chooseDate} loading={loading}
        />
      ) : (
        <HistoryPage
          visits={visits} query={query} selectedDate={selectedDate}
          clearQuery={() => setQuery("")}
          calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth}
          chooseDate={chooseDate} refresh={refresh} exportVisits={exportVisits}
          setToast={setToast} loading={loading}
        />
      )}
    </div>
  </div>;
}

function Sidebar({ view, setView, status }: {
  view: ViewKey; setView: (view: ViewKey) => void; status: ArchiveStatus;
}) {
  return <aside className="sidebar">
    <div className="brand"><img src="./icons/icon-48.png" alt="" /><strong>Webtrail</strong></div>
    <nav>
      <button data-active={view === "analysis"} onClick={() => setView("analysis")}><ChartBar /><span>可视化分析</span></button>
      <button data-active={view === "history"} onClick={() => setView("history")}><ClockCounterClockwise /><span>历史记录</span></button>
    </nav>
    <div className="sync-state" title={status.phase === "error" ? status.error : "永久本地归档正常"}>
      <ShieldCheck weight="fill" /><span>数据已归档</span>
    </div>
  </aside>;
}

function Topbar(props: {
  view: ViewKey; query: string; setQuery: (value: string) => void; onSearch: () => void;
  theme: Theme; toggleTheme: () => void; onExport: () => void;
}) {
  return <header className="topbar">
    <label className="search">
      <MagnifyingGlass />
      <input
        value={props.query}
        onChange={(event) => props.setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") props.onSearch(); }}
        placeholder="搜索标题、网址或域名"
      />
    </label>
    <button className="top-action" onClick={props.onExport}><DownloadSimple />导出</button>
    <button className="theme-toggle" onClick={props.toggleTheme} title={props.theme === "light" ? "切换深色模式" : "切换浅色模式"}>
      {props.theme === "light" ? <Moon /> : <Sun />}
    </button>
  </header>;
}

function AnalysisPage(props: {
  theme: Theme; mode: PeriodMode; setMode: (mode: PeriodMode) => void;
  selectedDate: string; calendarMonth: string; setCalendarMonth: (month: string) => void;
  visits: ArchivedVisit[]; chooseDate: (date: string) => void; loading: boolean;
}) {
  const bounds = periodBounds(props.mode, props.selectedDate);
  const periodVisits = useMemo(() =>
    props.visits.filter((visit) => visit.visitTime >= bounds.start && visit.visitTime < bounds.end),
  [bounds.end, bounds.start, props.visits]);
  const previousVisits = useMemo(() =>
    comparisonVisits(props.mode, props.selectedDate, props.visits),
  [props.mode, props.selectedDate, props.visits]);
  const buckets = useMemo(() =>
    periodBuckets(props.mode, props.selectedDate, periodVisits),
  [periodVisits, props.mode, props.selectedDate]);
  const ranking = useMemo(() => domainRanking(periodVisits).slice(0, 5), [periodVisits]);
  const contribution = useMemo(() =>
    contributionModel(props.visits, props.selectedDate, props.mode),
  [props.mode, props.selectedDate, props.visits]);
  const change = percentChange(periodVisits.length, previousVisits.length);
  const focusedTime = props.mode === "day"
    ? props.selectedDate === TODAY ? Date.now() : null
    : dayStart(props.selectedDate);
  const dark = props.theme === "dark";
  const ink = dark ? "#edf3fc" : "#172033";
  const muted = dark ? "#99a8bd" : "#69758a";
  const grid = dark ? "#29364a" : "#e9edf3";
  const tooltip = {
    backgroundColor: dark ? "#111a2a" : "#ffffff",
    borderColor: dark ? "#344258" : "#dfe5ee",
    textStyle: { color: ink }
  };

  const barOption: EChartsOption = {
    animationDuration: 360,
    grid: { left: 47, right: 20, top: 26, bottom: 38 },
    tooltip: {
      ...tooltip, trigger: "item",
      formatter: (params: unknown) => {
        const item = params as { data: { value: number; label: string } };
        return `${item.data.label}<br/><b>${item.data.value.toLocaleString("zh-CN")}</b> 次访问`;
      }
    },
    xAxis: {
      type: "category", data: buckets.map((bucket) => bucket.label),
      axisLine: { lineStyle: { color: grid } }, axisTick: { show: false },
      axisLabel: { color: muted, interval: props.mode === "day" ? 1 : props.mode === "month" ? 2 : 0, fontSize: 10 }
    },
    yAxis: {
      type: "value", splitNumber: 4, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 10 }, splitLine: { lineStyle: { color: grid } }
    },
    series: [{
      type: "bar", barMaxWidth: props.mode === "day" ? 22 : props.mode === "week" ? 50 : 18,
      data: buckets.map((bucket) => ({
        value: bucket.count, label: bucket.label, start: bucket.start,
        itemStyle: { color: focusedTime !== null && bucket.start <= focusedTime && bucket.end > focusedTime ? "#0f5fd7" : ACCENT }
      })),
      itemStyle: { borderRadius: [3, 3, 0, 0], opacity: .88 },
      emphasis: { itemStyle: { opacity: 1 } }
    }]
  };

  const heatColors = dark
    ? ["#1b2533", "#334155", "#4b5f75", "#71839a", "#a6b3c2"]
    : ["#f1f3f5", "#dce3ea", "#aebbc9", "#73859a", "#334155"];
  const heatOption: EChartsOption = {
    animationDuration: 250,
    grid: { left: 35, right: 14, top: 28, bottom: 38 },
    tooltip: {
      ...tooltip, trigger: "item",
      formatter: (params: unknown) => {
        const item = params as { data: { value: [number, number, number]; date: string } };
        return `${item.data.date}<br/><b>${item.data.value[2].toLocaleString("zh-CN")}</b> 次访问`;
      }
    },
    xAxis: {
      type: "category", data: contribution.labels, position: "top",
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: muted, interval: 0, fontSize: 9 }
    },
    yAxis: {
      type: "category", inverse: true, data: WEEKDAYS,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 9 }
    },
    visualMap: {
      min: 0, max: contribution.max, calculable: false, orient: "horizontal",
      left: 40, bottom: 4, itemWidth: 11, itemHeight: 7,
      text: ["多", "少"], textStyle: { color: muted, fontSize: 9 },
      inRange: { color: heatColors }
    },
    series: [{
      type: "heatmap", data: contribution.data,
      itemStyle: { borderColor: dark ? "#111a2a" : "#ffffff", borderWidth: 2, borderRadius: 1 },
      emphasis: { itemStyle: { borderColor: ACCENT, borderWidth: 2 } }
    }]
  };

  const rankingMax = ranking[0]?.count || 1;
  const domainOption: EChartsOption = {
    animationDuration: 300,
    grid: { left: 128, right: 42, top: 12, bottom: 18 },
    tooltip: { ...tooltip, trigger: "item", formatter: "{b}<br/><b>{c}</b> 次访问" },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category", inverse: true, data: ranking.map((item) => item.domain),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: ink, width: 112, overflow: "truncate", fontSize: 10 }
    },
    series: [{
      type: "bar", barWidth: 8,
      data: ranking.map((item) => item.count),
      itemStyle: { color: ACCENT, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: muted, fontSize: 10 },
      backgroundStyle: { color: grid, borderRadius: 4 },
      showBackground: true
    }],
    graphic: ranking.length ? [] : [{
      type: "text", left: "center", top: "middle",
      style: { text: "当前范围暂无域名数据", fill: muted, fontSize: 11 }
    }]
  };

  return <div className="analysis-page">
    <main className="analysis-main">
      <header className="analysis-heading">
        <div><h1>可视化分析</h1><p>按时间尺度观察真实浏览轨迹</p></div>
        <div className="period-tabs" role="tablist">
          {(["day", "week", "month"] as PeriodMode[]).map((item) =>
            <button key={item} role="tab" aria-selected={props.mode === item} onClick={() => props.setMode(item)}>
              {{ day: "天", week: "周", month: "月" }[item]}
            </button>
          )}
        </div>
      </header>
      <section className="data-panel trend-card">
        <header className="data-heading">
          <div><h2>{props.mode === "day" ? "当天访问趋势" : "访问趋势"}</h2><span>{trendPeriodLabel(props.mode, props.selectedDate)}</span></div>
          <div className="headline-metrics">
            <span>总访问次数 <b>{compact(periodVisits.length)}</b></span>
            <span className={change >= 0 ? "positive" : "negative"}>较上期 <b>{change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(1)}%</b></span>
          </div>
        </header>
        {props.loading ? <Skeleton /> : <Chart option={barOption} onClick={(event) => {
          const start = (event.data as { start?: number } | undefined)?.start;
          if (start) props.chooseDate(localDate(start));
        }} />}
      </section>
      <div className="analysis-grid">
        <section className="data-panel heat-card">
          <header className="data-heading"><div><h2>浏览热力图</h2><span>{contribution.subtitle} · 点击方格定位日期</span></div></header>
          <Chart option={heatOption} onClick={(event) => {
            const date = (event.data as { date?: string } | undefined)?.date;
            if (date) { props.chooseDate(date); props.setMode("day"); }
          }} />
        </section>
        <section className="data-panel domain-card">
          <header className="data-heading"><div><h2>热门域名 TOP 5</h2><span>{periodLabel(props.mode, props.selectedDate)}</span></div></header>
          <Chart option={domainOption} />
        </section>
      </div>
    </main>
    <aside className="analysis-rail">
      <CalendarPanel
        title="日期" month={props.calendarMonth} setMonth={props.setCalendarMonth}
        visits={props.visits} selectedDate={props.selectedDate}
        chooseDate={(date) => { props.chooseDate(date); props.setMode("day"); }}
        showDensity
      />
      <div className="rail-summary">
        <span>当前范围</span><strong>{compact(periodVisits.length)} 次访问</strong>
        <small>{new Set(periodVisits.map((visit) => visit.domain)).size} 个独立域名</small>
      </div>
    </aside>
  </div>;
}

function HistoryPage(props: {
  visits: ArchivedVisit[]; query: string; clearQuery: () => void; selectedDate: string;
  calendarMonth: string; setCalendarMonth: (month: string) => void;
  chooseDate: (date: string) => void; refresh: () => void;
  exportVisits: (visits: ArchivedVisit[]) => void; setToast: (text: string) => void;
  loading: boolean;
}) {
  const [preset, setPreset] = useState<DatePreset>(isExtension ? "today" : "custom");
  const [domains, setDomains] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<SourceGroup>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const dateBounds = useMemo(() => {
    if (preset === "all") return { start: 0, end: Date.now() + DAY };
    if (preset === "yesterday") {
      const start = dayStart(shiftDate(TODAY, -1));
      return { start, end: start + DAY };
    }
    if (preset === "week") return { start: dayStart(shiftDate(TODAY, -6)), end: dayStart(TODAY) + DAY };
    if (preset === "month") {
      const now = new Date(`${TODAY}T12:00:00`);
      return { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: dayStart(TODAY) + DAY };
    }
    const date = preset === "custom" ? props.selectedDate : TODAY;
    const start = dayStart(date);
    return { start, end: start + DAY };
  }, [preset, props.selectedDate]);

  const dateVisits = useMemo(() =>
    props.visits.filter((visit) => visit.visitTime >= dateBounds.start && visit.visitTime < dateBounds.end),
  [dateBounds.end, dateBounds.start, props.visits]);
  const domainOptions = useMemo(() => domainRanking(dateVisits).slice(0, 7), [dateVisits]);
  const filtered = useMemo(() => {
    const text = props.query.trim().toLowerCase();
    return dateVisits.filter((visit) => {
      if (text && !`${visit.title} ${visit.url} ${visit.domain}`.toLowerCase().includes(text)) return false;
      if (domains.size && !domains.has(visit.domain)) return false;
      if (types.size && !types.has(sourceGroup(visit.transition))) return false;
      return true;
    });
  }, [dateVisits, domains, props.query, types]);
  const selectedVisits = useMemo(() => filtered.filter((visit) => selected.has(visit.id)), [filtered, selected]);
  const groupedDays = useMemo(() => {
    const map = new Map<string, ArchivedVisit[]>();
    filtered.forEach((visit) => {
      const key = localDate(visit.visitTime);
      const list = map.get(key) || [];
      list.push(visit);
      map.set(key, list);
    });
    return Array.from(map, ([date, dayVisits]) => ({ date, visits: dayVisits, sessions: buildSessions(dayVisits) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [filtered]);

  useEffect(() => {
    const first = groupedDays.flatMap((day) => day.sessions).slice(0, 2).map((session) => session.id);
    setExpanded(new Set(first));
  }, [groupedDays]);

  useEffect(() => {
    setSelected(new Set());
  }, [preset, domains, types, props.query]);

  const toggleSet = <T extends string>(set: Set<T>, value: T, update: (next: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    update(next);
  };

  const toggleVisit = (id: string) => toggleSet(selected, id, setSelected);
  const toggleSession = (session: VisitSession) => {
    const next = new Set(selected);
    const allSelected = session.visits.every((visit) => next.has(visit.id));
    session.visits.forEach((visit) => allSelected ? next.delete(visit.id) : next.add(visit.id));
    setSelected(next);
  };

  const openSelected = async () => {
    const urls = Array.from(new Set(selectedVisits.map((visit) => visit.url)));
    if (!urls.length) return;
    if (isExtension) await sendExtensionMessage({ type: "OPEN_URLS", urls });
    else urls.slice(0, 3).forEach((url) => window.open(url, "_blank", "noopener"));
    props.setToast(`已打开 ${Math.min(urls.length, 30)} 个页面`);
  };

  const deleteNative = async () => {
    const urls = Array.from(new Set(selectedVisits.filter((visit) => visit.nativePresent).map((visit) => visit.url)));
    if (!urls.length) return props.setToast("所选记录已不在 Chrome 原生历史中");
    if (!window.confirm(`从 Chrome 历史删除 ${urls.length} 个 URL？Webtrail 永久归档仍会保留。`)) return;
    await sendExtensionMessage({ type: "DELETE_NATIVE", urls });
    setSelected(new Set());
    props.setToast("已从 Chrome 删除，Webtrail 归档仍保留");
    props.refresh();
  };

  const choosePreset = (next: DatePreset) => {
    setPreset(next);
    if (next === "today") props.chooseDate(TODAY);
    if (next === "yesterday") props.chooseDate(shiftDate(TODAY, -1));
  };

  return <div className="history-page">
    <aside className="history-filters">
      <header><Funnel /><h2>快速定位</h2></header>
      <div className="date-presets">
        {([
          ["today", "今天"], ["yesterday", "昨天"], ["week", "最近 7 天"],
          ["month", "本月"], ["all", "全部记录"]
        ] as Array<[DatePreset, string]>).map(([key, label]) =>
          <button key={key} data-active={preset === key} onClick={() => choosePreset(key)}>
            {key === "today" || key === "yesterday" ? <CalendarBlank /> : key === "week" ? <Clock /> : <Rows />}
            <span>{label}</span>
            {key === "all" ? <b>{compact(props.visits.length)}</b> : null}
          </button>
        )}
      </div>
      <CalendarPanel
        month={props.calendarMonth} setMonth={props.setCalendarMonth}
        visits={props.visits} selectedDate={props.selectedDate}
        chooseDate={(date) => { props.chooseDate(date); setPreset("custom"); }}
        compact
      />
      <FilterGroup title="按域名">
        {domainOptions.map((item) =>
          <FilterCheck key={item.domain} checked={domains.has(item.domain)} label={item.domain} count={item.count}
            onClick={() => toggleSet(domains, item.domain, setDomains)} />
        )}
        {!domainOptions.length ? <small className="filter-empty">当前日期没有域名</small> : null}
      </FilterGroup>
      <FilterGroup title="访问类型">
        {SOURCE_TYPES.map((type) => {
          const count = dateVisits.filter((visit) => sourceGroup(visit.transition) === type).length;
          return <FilterCheck key={type} checked={types.has(type)} label={type} count={count}
            onClick={() => toggleSet(types, type, setTypes)} />;
        })}
      </FilterGroup>
    </aside>
    <main className="history-main">
      <header className="history-heading">
        <div><h1>历史记录</h1><p>{presetText(preset, props.selectedDate)} · {filtered.length.toLocaleString("zh-CN")} 条记录</p></div>
        {(domains.size || types.size || props.query) ? <button onClick={() => {
          setDomains(new Set());
          setTypes(new Set());
          props.clearQuery();
        }}>清除筛选</button> : null}
      </header>
      {props.loading ? <HistorySkeleton /> : groupedDays.length ? groupedDays.map((day) =>
        <HistoryDay
          key={day.date} date={day.date} sessions={day.sessions}
          selected={selected} expanded={expanded}
          toggleVisit={toggleVisit} toggleSession={toggleSession}
          toggleExpanded={(id) => toggleSet(expanded, id, setExpanded)}
        />
      ) : <div className="history-empty"><MagnifyingGlass /><h2>没有找到匹配记录</h2><p>调整日期、域名或访问类型筛选。</p></div>}
    </main>
    {selectedVisits.length ? <div className="bulk-bar">
      <span>已选择 <b>{selectedVisits.length}</b> 项</span>
      <button className="primary" onClick={() => void openSelected()}><ArrowSquareOut />打开</button>
      <button onClick={() => props.exportVisits(selectedVisits)}><Export />导出</button>
      <button className="danger" onClick={() => void deleteNative()}><Trash />删除</button>
    </div> : null}
  </div>;
}

function presetText(preset: DatePreset, selectedDate: string) {
  if (preset === "today") return `今天 · ${shortDay(TODAY)}`;
  if (preset === "yesterday") return `昨天 · ${shortDay(shiftDate(TODAY, -1))}`;
  if (preset === "week") return "最近 7 天";
  if (preset === "month") return "本月";
  if (preset === "all") return "全部记录";
  return fullDate(selectedDate);
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="filter-group"><h3>{title}</h3>{children}</section>;
}

function FilterCheck(props: { checked: boolean; label: string; count: number; onClick: () => void }) {
  return <button className="filter-check" onClick={props.onClick}>
    <i data-checked={props.checked}>{props.checked ? <Check weight="bold" /> : null}</i>
    <span>{props.label}</span><b>{props.count}</b>
  </button>;
}

function HistoryDay(props: {
  date: string; sessions: VisitSession[]; selected: Set<string>; expanded: Set<string>;
  toggleVisit: (id: string) => void; toggleSession: (session: VisitSession) => void;
  toggleExpanded: (id: string) => void;
}) {
  const label = props.date === TODAY ? `今天 · ${shortDay(props.date)}` :
    props.date === shiftDate(TODAY, -1) ? `昨天 · ${shortDay(props.date)}` : fullDate(props.date);
  const count = props.sessions.reduce((sum, session) => sum + session.visits.length, 0);
  return <section className="history-day">
    <header><h2>{label}</h2><span>{props.sessions.length} 个会话 · {count} 条记录</span></header>
    {props.sessions.map((session) =>
      <HistorySession
        key={session.id} session={session} selected={props.selected}
        expanded={props.expanded.has(session.id)}
        toggleVisit={props.toggleVisit} toggleSession={props.toggleSession}
        toggleExpanded={() => props.toggleExpanded(session.id)}
      />
    )}
  </section>;
}

function HistorySession(props: {
  session: VisitSession; selected: Set<string>; expanded: boolean;
  toggleVisit: (id: string) => void; toggleSession: (session: VisitSession) => void;
  toggleExpanded: () => void;
}) {
  const allSelected = props.session.visits.every((visit) => props.selected.has(visit.id));
  return <section className="history-session">
    <header>
      <button className="session-toggle" onClick={props.toggleExpanded} aria-label={props.expanded ? "折叠会话" : "展开会话"}>
        {props.expanded ? <CaretUp /> : <CaretDown />}
      </button>
      <button className="row-check" data-checked={allSelected} onClick={() => props.toggleSession(props.session)}>
        {allSelected ? <Check weight="bold" /> : null}
      </button>
      <div><strong>{formatTime(props.session.start)} — {formatTime(props.session.end)}</strong><span>{props.session.title}</span></div>
      <small>{props.session.visits.length} 条记录 · 观察跨度 {formatSpan(props.session.span)}</small>
    </header>
    {props.expanded ? <div className="session-rows">
      {props.session.visits.slice().reverse().map((visit) =>
        <HistoryRow key={visit.id} visit={visit} selected={props.selected.has(visit.id)} toggle={() => props.toggleVisit(visit.id)} />
      )}
    </div> : null}
  </section>;
}

function HistoryRow({ visit, selected, toggle }: { visit: ArchivedVisit; selected: boolean; toggle: () => void }) {
  return <div className="history-row" data-selected={selected}>
    <button className="row-check" data-checked={selected} onClick={toggle}>{selected ? <Check weight="bold" /> : null}</button>
    <time>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(visit.visitTime)}</time>
    <Favicon visit={visit} />
    <a href={visit.url} target="_blank" rel="noreferrer">
      <strong>{visit.title || visit.domain}</strong><span>{visit.url}</span>
    </a>
    <span className="row-domain">{visit.domain}</span>
    <span className="row-source">{sourceText(visit.transition)}</span>
    <a className="row-open" href={visit.url} target="_blank" rel="noreferrer" title="打开页面"><ArrowSquareOut /></a>
  </div>;
}

function Favicon({ visit }: { visit: ArchivedVisit }) {
  const url = faviconUrl(visit.url);
  return url ? <img className="favicon" src={url} alt="" /> :
    <i className="favicon-fallback">{visit.domain[0]?.toUpperCase()}</i>;
}

function CalendarPanel(props: {
  title?: string; month: string; setMonth: (month: string) => void;
  visits: ArchivedVisit[]; selectedDate: string; chooseDate: (date: string) => void;
  showDensity?: boolean; compact?: boolean;
}) {
  const counts = new Map<string, number>();
  props.visits.forEach((visit) => {
    const date = localDate(visit.visitTime);
    counts.set(date, (counts.get(date) || 0) + 1);
  });
  const max = Math.max(...counts.values(), 1);
  const moveMonth = (offset: number) => {
    const [year, month] = props.month.split("-").map(Number);
    props.setMonth(localDate(new Date(year, month - 1 + offset, 1)).slice(0, 7));
  };
  return <section className={`calendar-panel ${props.compact ? "compact" : ""}`}>
    {props.title ? <div className="calendar-title"><h2>{props.title}</h2><span>访问次数</span></div> : null}
    <header><button onClick={() => moveMonth(-1)}><CaretLeft /></button><strong>{monthLabel(props.month)}</strong><button onClick={() => moveMonth(1)}><CaretRight /></button></header>
    <div className="calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{calendarCells(props.month).map((cell) => {
      const count = counts.get(cell.date) || 0;
      return <button
        key={cell.date} data-current={cell.current} data-selected={cell.date === props.selectedDate}
        style={{ "--density": props.showDensity && count ? .08 + count / max * .32 : 0 } as React.CSSProperties}
        onClick={() => props.chooseDate(cell.date)} title={`${cell.date} · ${count} 次访问`}
      >{cell.day}</button>;
    })}</div>
  </section>;
}

function Skeleton() {
  return <div className="skeleton"><i /><i /><i /><i /></div>;
}

function HistorySkeleton() {
  return <div className="history-skeleton">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>;
}
