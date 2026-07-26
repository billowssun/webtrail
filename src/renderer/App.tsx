import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EChartsCoreOption as EChartsOption } from "echarts/core";
import {
  Archive, ArrowClockwise, ArrowSquareOut, CalendarBlank, CaretLeft, CaretRight,
  ChartLineUp, ClockCounterClockwise, DownloadSimple, Export, GearSix, Globe,
  MagnifyingGlass, Moon, Rows, ShieldCheck, Stack, Sun, UploadSimple
} from "@phosphor-icons/react";
import Chart from "./Chart";
import {
  downloadBlob, ensureDemoArchive, exportArchiveJson, faviconUrl, getArchiveStats,
  getArchiveStatus, importArchiveFile, isExtension, queryVisits, sendExtensionMessage,
  type ArchivedVisit, type ArchiveStatus
} from "./archiveDb";
import { buildSessions, domainRanking, formatDate, formatSpan, formatTime } from "./historyModel";
import {
  DAY, dailySeries, dayStart, localDate, observedSpan, percentChange, shiftDate,
  sourceGroup, sourceMix, weekdayHourMatrix
} from "./visualizationModel";

type ViewKey = "insights" | "sessions" | "pages" | "domains" | "settings";
type Theme = "light" | "dark";
type Filter = { kind: "domain" | "source" | "hour"; value: string } | null;
type Stats = { count: number; oldest: number | null; newest: number | null; usage: number; quota: number };

const TODAY = localDate(Date.now());
const COLORS = ["#1769e8", "#2dbd8b", "#ffb020", "#23b7c9", "#7c6cf2"];
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function compact(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function fullDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
    .format(new Date(`${date}T12:00:00`));
}

function monthLabel(month: string) {
  const [year, value] = month.split("-").map(Number);
  return `${year}年${value}月`;
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

function themeOption(theme: Theme) {
  const dark = theme === "dark";
  return {
    ink: dark ? "#ecf2fb" : "#172033",
    muted: dark ? "#8fa0b8" : "#69758a",
    grid: dark ? "#28354a" : "#e8edf5",
    tooltip: dark ? "#111827" : "#ffffff",
    tooltipBorder: dark ? "#344258" : "#dfe5ee"
  };
}

export default function App() {
  const [view, setView] = useState<ViewKey>("insights");
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("webtrail-theme") as Theme | null;
    return saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  });
  const [rangeDays, setRangeDays] = useState(30);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [calendarMonth, setCalendarMonth] = useState(TODAY.slice(0, 7));
  const [visits, setVisits] = useState<ArchivedVisit[]>([]);
  const [monthVisits, setMonthVisits] = useState<ArchivedVisit[]>([]);
  const [stats, setStats] = useState<Stats>({ count: 0, oldest: null, newest: null, usage: 0, quota: 0 });
  const [status, setStatus] = useState<ArchiveStatus>({ phase: "idle" });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

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
      const currentStart = dayStart(shiftDate(selectedDate, -rangeDays + 1));
      const previousStart = currentStart - rangeDays * DAY;
      const end = dayStart(selectedDate) + DAY;
      try {
        const [nextVisits, nextStats, nextStatus] = await Promise.all([
          queryVisits({ startTime: previousStart, endTime: end, limit: 100_000 }),
          getArchiveStats(),
          getArchiveStatus()
        ]);
        if (!cancelled) {
          setVisits(nextVisits);
          setStats(nextStats);
          setStatus(nextStatus);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [rangeDays, refreshKey, selectedDate]);

  useEffect(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    void queryVisits({
      startTime: new Date(year, month - 1, 1).getTime(),
      endTime: new Date(year, month, 1).getTime(),
      limit: 100_000
    }).then(setMonthVisits);
  }, [calendarMonth, refreshKey]);

  const periodStart = dayStart(shiftDate(selectedDate, -rangeDays + 1));
  const periodEnd = dayStart(selectedDate) + DAY;
  const currentVisits = useMemo(() => visits.filter((visit) => visit.visitTime >= periodStart && visit.visitTime < periodEnd), [periodEnd, periodStart, visits]);
  const previousVisits = useMemo(() => visits.filter((visit) => visit.visitTime < periodStart), [periodStart, visits]);
  const dayVisits = useMemo(() => currentVisits.filter((visit) => localDate(visit.visitTime) === selectedDate), [currentVisits, selectedDate]);
  const sessions = useMemo(() => buildSessions(currentVisits), [currentVisits]);
  const daySessions = useMemo(() => buildSessions(dayVisits), [dayVisits]);
  const ranking = useMemo(() => domainRanking(currentVisits), [currentVisits]);
  const mix = useMemo(() => sourceMix(currentVisits), [currentVisits]);
  const trend = useMemo(() => dailySeries(currentVisits, rangeDays, selectedDate), [currentVisits, rangeDays, selectedDate]);
  const previousTrend = useMemo(() => dailySeries(previousVisits, rangeDays, shiftDate(selectedDate, -rangeDays)), [previousVisits, rangeDays, selectedDate]);
  const heat = useMemo(() => weekdayHourMatrix(currentVisits), [currentVisits]);
  const filteredEvidence = useMemo(() => {
    const text = query.trim().toLowerCase();
    return currentVisits.filter((visit) => {
      if (text && !`${visit.title} ${visit.url} ${visit.domain}`.toLowerCase().includes(text)) return false;
      if (!filter) return true;
      if (filter.kind === "domain") return visit.domain === filter.value;
      if (filter.kind === "source") return sourceGroup(visit.transition) === filter.value;
      return new Date(visit.visitTime).getHours() === Number(filter.value);
    });
  }, [currentVisits, filter, query]);

  const syncNow = async () => {
    await sendExtensionMessage({ type: "SYNC_NOW" });
    setToast("已同步最新 Chrome 历史");
    refresh();
  };

  const exportCsv = () => {
    const rows = [["时间", "标题", "URL", "域名", "导航类型"]]
      .concat(filteredEvidence.map((visit) => [new Date(visit.visitTime).toISOString(), visit.title, visit.url, visit.domain, visit.transition]));
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    downloadBlob(`\uFEFF${csv}`, `webtrail-${selectedDate}.csv`, "text/csv;charset=utf-8");
    setToast(`已导出 ${filteredEvidence.length} 条记录`);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    const count = await importArchiveFile(file);
    setToast(`已导入 ${count} 条记录`);
    refresh();
  };

  return (
    <div className="app-shell">
      <Sidebar view={view} onView={setView} status={status} />
      <div className="app-main">
        <Topbar
          rangeDays={rangeDays} setRangeDays={setRangeDays}
          selectedDate={selectedDate} setSelectedDate={(date) => { setSelectedDate(date); setCalendarMonth(date.slice(0, 7)); }}
          query={query} setQuery={setQuery}
          theme={theme} toggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
          onExport={exportCsv}
        />
        {toast ? <button className="toast" onClick={() => setToast("")}><ShieldCheck weight="fill" />{toast}</button> : null}
        {view === "insights" ? (
          <Dashboard
            theme={theme} loading={loading} rangeDays={rangeDays} selectedDate={selectedDate}
            current={currentVisits} previous={previousVisits} dayVisits={dayVisits}
            daySessions={daySessions} trend={trend} previousTrend={previousTrend}
            heat={heat} ranking={ranking} mix={mix}
            calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth}
            monthVisits={monthVisits} chooseDate={(date) => { setSelectedDate(date); setCalendarMonth(date.slice(0, 7)); }}
            stats={stats} status={status}
            evidence={filteredEvidence} filter={filter} setFilter={setFilter}
          />
        ) : view === "sessions" ? (
          <RecordsView title="浏览会话" subtitle={`${rangeDays} 天内共 ${sessions.length} 个会话`} visits={filteredEvidence} mode="sessions" />
        ) : view === "pages" ? (
          <RecordsView title="全部记录" subtitle={`当前范围 ${filteredEvidence.length} 次访问`} visits={filteredEvidence} mode="pages" />
        ) : view === "domains" ? (
          <DomainView ranking={ranking} total={currentVisits.length} onDomain={(domain) => { setFilter({ kind: "domain", value: domain }); setView("pages"); }} />
        ) : (
          <Settings stats={stats} status={status} theme={theme} setTheme={setTheme} onSync={() => void syncNow()} onImport={() => importRef.current?.click()} onExport={() => void exportArchiveJson()} />
        )}
      </div>
      <input ref={importRef} hidden type="file" accept=".json,.csv" onChange={(event) => void importFile(event.target.files?.[0])} />
    </div>
  );
}

function Sidebar({ view, onView, status }: { view: ViewKey; onView: (view: ViewKey) => void; status: ArchiveStatus }) {
  const items: Array<{ key: ViewKey; label: string; icon: React.ReactNode }> = [
    { key: "insights", label: "洞察", icon: <ChartLineUp /> },
    { key: "sessions", label: "会话", icon: <Stack /> },
    { key: "pages", label: "记录", icon: <Rows /> },
    { key: "domains", label: "域名", icon: <Globe /> },
    { key: "settings", label: "设置", icon: <GearSix /> }
  ];
  return <aside className="sidebar">
    <div className="brand"><img src="./icons/icon-48.png" alt="" /><strong>Webtrail</strong></div>
    <nav>{items.map((item) => <button key={item.key} data-active={view === item.key} onClick={() => onView(item.key)}>{item.icon}<span>{item.label}</span></button>)}</nav>
    <div className="sync-state" title={status.phase === "error" ? status.error : "本地归档正常"}>
      <ShieldCheck weight="fill" /><span>数据已归档</span>
    </div>
  </aside>;
}

function Topbar(props: {
  rangeDays: number; setRangeDays: (value: number) => void; selectedDate: string; setSelectedDate: (date: string) => void;
  query: string; setQuery: (query: string) => void; theme: Theme; toggleTheme: () => void; onExport: () => void;
}) {
  return <header className="topbar">
    <label className="range-control"><CalendarBlank /><span>近</span>
      <select value={props.rangeDays} onChange={(event) => props.setRangeDays(Number(event.target.value))}>
        <option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option>
      </select>
      <span className="range-dates">{shiftDate(props.selectedDate, -props.rangeDays + 1)} → {props.selectedDate}</span>
    </label>
    <label className="search"><MagnifyingGlass /><input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="搜索域名或页面标题（支持回车）" /></label>
    <button className="today" onClick={() => props.setSelectedDate(TODAY)}>今天</button>
    <button className="icon-label" onClick={props.onExport}><DownloadSimple />导出</button>
    <button className="theme-toggle" onClick={props.toggleTheme} title={props.theme === "light" ? "切换深色模式" : "切换浅色模式"}>
      {props.theme === "light" ? <Moon /> : <Sun />}
    </button>
  </header>;
}

function Dashboard(props: {
  theme: Theme; loading: boolean; rangeDays: number; selectedDate: string;
  current: ArchivedVisit[]; previous: ArchivedVisit[]; dayVisits: ArchivedVisit[];
  daySessions: ReturnType<typeof buildSessions>;
  trend: Array<{ date: string; count: number }>; previousTrend: Array<{ date: string; count: number }>;
  heat: number[][]; ranking: Array<{ domain: string; count: number }>; mix: Array<{ name: string; value: number }>;
  calendarMonth: string; setCalendarMonth: (month: string) => void; monthVisits: ArchivedVisit[]; chooseDate: (date: string) => void;
  stats: Stats; status: ArchiveStatus; evidence: ArchivedVisit[]; filter: Filter; setFilter: (filter: Filter) => void;
}) {
  const palette = themeOption(props.theme);
  const comparison = percentChange(props.current.length, props.previous.length);
  const average = props.rangeDays ? Math.round(props.current.length / props.rangeDays) : 0;
  const common = {
    textStyle: { color: palette.muted, fontFamily: "Segoe UI Variable, Segoe UI, sans-serif" },
    animationDuration: 420,
    tooltip: { trigger: "axis", backgroundColor: palette.tooltip, borderColor: palette.tooltipBorder, textStyle: { color: palette.ink } }
  } as const;
  const trendOption: EChartsOption = {
    ...common,
    grid: { left: 46, right: 16, top: 44, bottom: 34 },
    legend: { top: 4, left: 0, textStyle: { color: palette.muted }, itemWidth: 18, itemHeight: 2 },
    xAxis: { type: "category", boundaryGap: false, data: props.trend.map((item) => item.date.slice(5)), axisLine: { lineStyle: { color: palette.grid } }, axisTick: { show: false }, axisLabel: { color: palette.muted, interval: Math.max(0, Math.floor(props.rangeDays / 8) - 1) } },
    yAxis: { type: "value", splitNumber: 4, axisLabel: { color: palette.muted }, splitLine: { lineStyle: { color: palette.grid } } },
    series: [
      { name: "本期访问次数", type: "line", smooth: .25, showSymbol: true, symbolSize: 7, data: props.trend.map((item) => ({ value: item.count, date: item.date })), lineStyle: { width: 2, color: COLORS[0] }, itemStyle: { color: COLORS[0] }, areaStyle: { color: "rgba(23,105,232,.08)" } },
      { name: "上期访问次数", type: "line", smooth: .25, showSymbol: false, data: props.previousTrend.map((item) => item.count), lineStyle: { width: 1.5, type: "dashed", color: "#8babdc" }, itemStyle: { color: "#8babdc" } },
      { name: "日均", type: "line", symbol: "none", data: props.trend.map(() => average), lineStyle: { width: 1, type: "dotted", color: "#a6afbd" } }
    ]
  };
  const heatMax = Math.max(...props.heat.map((item) => item[2]), 1);
  const heatOption: EChartsOption = {
    ...common,
    tooltip: { ...common.tooltip, trigger: "item", formatter: (params: unknown) => {
      const value = (params as { value: number[] }).value;
      return `${WEEKDAYS[value[1]]} ${String(value[0]).padStart(2, "0")}:00<br/><b>${value[2].toLocaleString("zh-CN")}</b> 次访问`;
    } },
    grid: { left: 44, right: 10, top: 8, bottom: 30 },
    xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => i), splitArea: { show: true }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: palette.muted, interval: 1 } },
    yAxis: { type: "category", inverse: true, data: WEEKDAYS, splitArea: { show: true }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: palette.muted } },
    visualMap: { min: 0, max: heatMax, show: false, inRange: { color: props.theme === "dark" ? ["#17253d", "#165dc2", "#3b8bff"] : ["#eef5ff", "#8ebdff", "#1769e8"] } },
    series: [{ type: "heatmap", data: props.heat, itemStyle: { borderColor: props.theme === "dark" ? "#101828" : "#fff", borderWidth: 1.5, borderRadius: 2 } }]
  };
  const domainOption: EChartsOption = {
    ...common,
    tooltip: { ...common.tooltip, trigger: "item" },
    grid: { left: 126, right: 42, top: 7, bottom: 16 },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", inverse: true, data: props.ranking.slice(0, 8).map((item) => item.domain), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: palette.ink, width: 108, overflow: "truncate" } },
    series: [{ type: "bar", data: props.ranking.slice(0, 8).map((item) => item.count), barWidth: 9, itemStyle: { color: COLORS[0], borderRadius: [0, 3, 3, 0] }, label: { show: true, position: "right", color: palette.muted } }]
  };
  const sourceOption: EChartsOption = {
    ...common,
    color: COLORS,
    tooltip: { ...common.tooltip, trigger: "item", formatter: "{b}<br/><b>{c}</b> 次 · {d}%" },
    legend: { bottom: 0, left: "center", icon: "circle", itemWidth: 7, itemHeight: 7, textStyle: { color: palette.muted, fontSize: 10 } },
    series: [{ type: "pie", radius: ["42%", "68%"], center: ["50%", "42%"], data: props.mix, label: { show: false }, itemStyle: { borderColor: props.theme === "dark" ? "#101827" : "#fff", borderWidth: 2 } }],
    graphic: [{ type: "text", left: "center", top: "35%", style: { text: `总计\n${compact(props.current.length)}`, align: "center", fill: palette.ink, fontSize: 13, fontWeight: 700, lineHeight: 20 } }]
  };

  return <div className="dashboard">
    <main className="dashboard-main">
      <div className="page-title"><div><h1>浏览洞察</h1><p>你的浏览行为可视化分析</p></div><div className="metric-strip"><span>本期 <b>{compact(props.current.length)}</b></span><span>日均 <b>{compact(average)}</b></span><span className={comparison >= 0 ? "positive" : "negative"}>较上期 <b>{comparison >= 0 ? "↑" : "↓"} {Math.abs(comparison).toFixed(1)}%</b></span></div></div>
      <section className="panel trend-panel">
        <PanelTitle title="访问趋势" hint="点击日期查看当天记录" />
        {props.loading ? <Skeleton /> : <Chart option={trendOption} onClick={(event) => {
          const date = (event.data as { date?: string } | undefined)?.date;
          if (date) props.chooseDate(date);
        }} />}
      </section>
      <div className="chart-grid">
        <section className="panel"><PanelTitle title="按星期 / 小时热力图" hint="点击时段筛选记录" />
          <Chart option={heatOption} onClick={(event) => {
            const value = event.value as number[];
            if (value) props.setFilter({ kind: "hour", value: String(value[0]) });
          }} />
        </section>
        <section className="panel"><PanelTitle title="热门域名 TOP 8" hint="点击域名下钻" />
          <Chart option={domainOption} onClick={(event) => event.name && props.setFilter({ kind: "domain", value: event.name })} />
        </section>
        <section className="panel"><PanelTitle title="导航来源占比" hint="依据 Chrome transition 分类" />
          <Chart option={sourceOption} onClick={(event) => event.name && props.setFilter({ kind: "source", value: event.name })} />
        </section>
      </div>
      <EvidenceTable visits={props.evidence.slice(0, 7)} filter={props.filter} clearFilter={() => props.setFilter(null)} />
    </main>
    <aside className="dashboard-rail">
      <CalendarHeatmap month={props.calendarMonth} setMonth={props.setCalendarMonth} visits={props.monthVisits} selectedDate={props.selectedDate} chooseDate={props.chooseDate} />
      <section className="rail-panel day-card">
        <h3>{fullDate(props.selectedDate)}</h3>
        <Metric icon={<Rows />} label="访问次数" value={props.dayVisits.length.toLocaleString("zh-CN")} />
        <Metric icon={<ClockCounterClockwise />} label="会话数" value={props.daySessions.length.toLocaleString("zh-CN")} />
        <Metric icon={<Globe />} label="独立域名" value={new Set(props.dayVisits.map((visit) => visit.domain)).size.toLocaleString("zh-CN")} />
        <Metric icon={<ChartLineUp />} label="会话观察跨度" value={formatSpan(observedSpan(props.dayVisits))} />
        <p className="metric-note">观察跨度按同一会话首末访问计算，不等同于活跃时长。</p>
      </section>
      <section className="rail-panel coverage">
        <header><div><h3>归档覆盖</h3><strong>{props.stats.count ? "100" : "0"}<small>%</small></strong></div><Archive /></header>
        <p>{props.stats.oldest ? `${formatDate(props.stats.oldest)} 至今` : "等待首次归档"}</p>
        <div className="progress"><i style={{ width: props.stats.count ? "100%" : "0%" }} /></div>
        <dl><div><dt>永久记录</dt><dd>{props.stats.count.toLocaleString("zh-CN")}</dd></div><div><dt>本机占用</dt><dd>{formatBytes(props.stats.usage)}</dd></div></dl>
        <small><ShieldCheck weight="fill" />{props.status.phase === "error" ? "归档需要检查" : "数据仅保存在此设备"}</small>
      </section>
    </aside>
  </div>;
}

function PanelTitle({ title, hint }: { title: string; hint: string }) {
  return <header className="panel-title"><div><h2>{title}</h2><span title={hint}>i</span></div><small>{hint}</small></header>;
}

function Skeleton() {
  return <div className="skeleton"><i /><i /><i /><i /></div>;
}

function CalendarHeatmap(props: { month: string; setMonth: (month: string) => void; visits: ArchivedVisit[]; selectedDate: string; chooseDate: (date: string) => void }) {
  const counts = new Map<string, number>();
  props.visits.forEach((visit) => {
    const date = localDate(visit.visitTime);
    counts.set(date, (counts.get(date) || 0) + 1);
  });
  const max = Math.max(...counts.values(), 1);
  const moveMonth = (offset: number) => {
    const [year, month] = props.month.split("-").map(Number);
    const value = new Date(year, month - 1 + offset, 1);
    props.setMonth(localDate(value).slice(0, 7));
  };
  return <section className="rail-panel calendar">
    <div className="rail-heading"><h3>日期热力图</h3><span>访问次数</span></div>
    <header><button onClick={() => moveMonth(-1)}><CaretLeft /></button><strong>{monthLabel(props.month)}</strong><button onClick={() => moveMonth(1)}><CaretRight /></button></header>
    <div className="weekday">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-days">{calendarCells(props.month).map((cell) => {
      const count = counts.get(cell.date) || 0;
      return <button key={cell.date} data-current={cell.current} data-selected={cell.date === props.selectedDate} style={{ "--density": count ? .12 + count / max * .7 : 0 } as React.CSSProperties} onClick={() => props.chooseDate(cell.date)} title={`${cell.date} · ${count} 次访问`}>{cell.day}</button>;
    })}</div>
    <footer><span>少</span>{[.12, .28, .44, .6, .82].map((value) => <i key={value} style={{ "--density": value } as React.CSSProperties} />)}<span>多</span></footer>
  </section>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="day-metric"><span>{icon}{label}</span><strong>{value}</strong></div>;
}

function EvidenceTable({ visits, filter, clearFilter }: { visits: ArchivedVisit[]; filter: Filter; clearFilter: () => void }) {
  return <section className="panel evidence">
    <header><div><h2>近期访问记录</h2><p>图表结论对应的原始记录</p></div>{filter ? <button onClick={clearFilter}>清除筛选 · {filter.value}</button> : null}</header>
    <div className="table-head"><span>访问时间</span><span>页面</span><span>域名</span><span>来源</span><span>操作</span></div>
    {visits.length ? visits.map((visit) => <VisitRow key={visit.id} visit={visit} />) : <div className="empty-row">当前筛选没有记录</div>}
  </section>;
}

function VisitRow({ visit }: { visit: ArchivedVisit }) {
  return <div className="visit-table-row">
    <time>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(visit.visitTime)}</time>
    <span className="page-cell"><Favicon visit={visit} /><span><strong>{visit.title || visit.domain}</strong><small>{visit.url}</small></span></span>
    <span>{visit.domain}</span><span><i className="source-dot" />{sourceGroup(visit.transition)}</span>
    <a href={visit.url} target="_blank" rel="noreferrer" title="打开页面"><ArrowSquareOut /></a>
  </div>;
}

function Favicon({ visit }: { visit: ArchivedVisit }) {
  const url = faviconUrl(visit.url);
  return url ? <img src={url} alt="" /> : <i className="favicon-fallback">{visit.domain[0]?.toUpperCase()}</i>;
}

function RecordsView({ title, subtitle, visits, mode }: { title: string; subtitle: string; visits: ArchivedVisit[]; mode: "sessions" | "pages" }) {
  const sessions = buildSessions(visits);
  return <div className="simple-view"><header><h1>{title}</h1><p>{subtitle}</p></header>
    {mode === "sessions" ? sessions.map((session) => <section className="session-card" key={session.id}><header><div><strong>{session.title}</strong><span>{formatTime(session.start)} · 观察跨度 {formatSpan(session.span)}</span></div><b>{session.visits.length} 次</b></header>{session.visits.slice().reverse().slice(0, 8).map((visit) => <VisitRow key={visit.id} visit={visit} />)}</section>)
      : <section className="panel evidence">{visits.slice(0, 200).map((visit) => <VisitRow key={visit.id} visit={visit} />)}</section>}
  </div>;
}

function DomainView({ ranking, total, onDomain }: { ranking: Array<{ domain: string; count: number }>; total: number; onDomain: (domain: string) => void }) {
  const max = ranking[0]?.count || 1;
  return <div className="simple-view"><header><h1>域名排行</h1><p>当前时间范围内的访问分布</p></header><section className="domain-list">{ranking.map((item, index) => <button key={item.domain} onClick={() => onDomain(item.domain)}><b>{String(index + 1).padStart(2, "0")}</b><i>{item.domain[0]?.toUpperCase()}</i><strong>{item.domain}</strong><span><em style={{ width: `${item.count / max * 100}%` }} /></span><small>{item.count.toLocaleString("zh-CN")} · {(item.count / Math.max(total, 1) * 100).toFixed(1)}%</small></button>)}</section></div>;
}

function Settings(props: { stats: Stats; status: ArchiveStatus; theme: Theme; setTheme: (theme: Theme) => void; onSync: () => void; onImport: () => void; onExport: () => void }) {
  return <div className="simple-view settings"><header><h1>设置</h1><p>归档、备份与显示偏好</p></header>
    <section className="settings-card"><div><ShieldCheck /><span><strong>永久本地归档</strong><small>{props.stats.count.toLocaleString("zh-CN")} 条记录 · {formatBytes(props.stats.usage)}</small></span><b>{props.status.phase === "error" ? "异常" : "正常"}</b></div><div className="settings-actions"><button onClick={props.onSync}><ArrowClockwise />立即同步</button><button onClick={props.onImport}><UploadSimple />导入备份</button><button onClick={props.onExport}><Export />导出完整归档</button></div></section>
    <section className="settings-card"><div><Sun /><span><strong>外观</strong><small>默认白色，同时完整适配深色环境</small></span><select value={props.theme} onChange={(event) => props.setTheme(event.target.value as Theme)}><option value="light">浅色</option><option value="dark">深色</option></select></div></section>
  </div>;
}
