import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, PieChart } from "echarts/charts";
import { GraphicComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import type { BrowserDashboard, CalendarDay, DayDigest, RankingItem, ScanResult, TimelineItem } from "./types";

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, GraphicComponent, CanvasRenderer]);

type ViewKey = "overview" | "sites" | "pages" | "visits" | "timeline" | "raw";
type StatusTone = "info" | "success" | "warn" | "error";

const views: Array<{ key: ViewKey; label: string }> = [
  { key: "overview", label: "总览" },
  { key: "sites", label: "网站时长" },
  { key: "pages", label: "页面占比" },
  { key: "visits", label: "访问次数" },
  { key: "timeline", label: "时间线" },
  { key: "raw", label: "明细" }
];

function todayIso() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function monthTitle(year: number, month: number) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(new Date(year, month - 1, 1));
}

function splitDate(date: string) {
  const [year, month] = date.split("-").map(Number);
  return { year, month };
}

export default function App() {
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [visibleYear, setVisibleYear] = useState(() => new Date().getFullYear());
  const [visibleMonth, setVisibleMonth] = useState(() => new Date().getMonth() + 1);
  const [monthDays, setMonthDays] = useState<CalendarDay[]>([]);
  const [digest, setDigest] = useState<DayDigest | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [status, setStatus] = useState<{ message: string; tone: StatusTone }>({
    message: "准备就绪。选择日期后读取浏览记录，所有分析都保存在本机。",
    tone: "info"
  });

  const loadMonth = useCallback(async (year: number, month: number) => {
    const days = await window.dashboardApi.getMonth({ year, month });
    setMonthDays(days);
  }, []);

  const loadDay = useCallback(
    async (date: string) => {
      const { year, month } = splitDate(date);
      setSelectedDate(date);
      if (year !== visibleYear || month !== visibleMonth) {
        setVisibleYear(year);
        setVisibleMonth(month);
        await loadMonth(year, month);
      }
      const result = await window.dashboardApi.getDay(date);
      setDigest(result.digest);
    },
    [loadMonth, visibleMonth, visibleYear]
  );

  useEffect(() => {
    void loadMonth(visibleYear, visibleMonth);
  }, [loadMonth, visibleMonth, visibleYear]);

  useEffect(() => {
    void loadDay(selectedDate)
      .catch((error: Error) => setStatus({ message: `启动失败：${error.message}`, tone: "error" }))
      .finally(() => setIsLoading(false));
    // Initial load intentionally uses the boot date only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function scanHistory() {
    setIsScanning(true);
    setStatus({ message: "正在读取浏览器访问记录...", tone: "info" });
    try {
      const result = await window.dashboardApi.scanBrowserHistory(selectedDate);
      setLastScan(result);
      const errors = result.errors.length ? `；部分失败：${result.errors.join("；")}` : "";
      setStatus({
        message: `读取完成：${result.visits.length} 条记录，来源 ${result.availableBrowsers.length || 0} 个${errors}`,
        tone: result.errors.length ? "warn" : "success"
      });
      await loadMonth(visibleYear, visibleMonth);
      await loadDay(selectedDate);
    } catch (error) {
      setStatus({ message: `读取失败：${(error as Error).message}`, tone: "error" });
    } finally {
      setIsScanning(false);
    }
  }

  async function refreshDashboard() {
    setIsLoading(true);
    setStatus({ message: "正在刷新看板...", tone: "info" });
    try {
      await loadDay(selectedDate);
      await loadMonth(visibleYear, visibleMonth);
      setStatus({ message: "看板已刷新。", tone: "success" });
    } catch (error) {
      setStatus({ message: `刷新失败：${(error as Error).message}`, tone: "error" });
    } finally {
      setIsLoading(false);
    }
  }

  async function copySummary() {
    if (!digest) return;
    try {
      await navigator.clipboard.writeText(digest.dashboard.summary);
      setStatus({ message: "当日摘要已复制到剪贴板。", tone: "success" });
    } catch (error) {
      setStatus({ message: `复制失败：${(error as Error).message}`, tone: "error" });
    }
  }

  function shiftMonth(delta: number) {
    const date = new Date(visibleYear, visibleMonth - 1 + delta, 1);
    setVisibleYear(date.getFullYear());
    setVisibleMonth(date.getMonth() + 1);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <section className="brand">
          <div className="brand-mark">W</div>
          <div>
            <h1>Webtrail</h1>
            <p>本机浏览历史看板</p>
          </div>
        </section>

        <CalendarPanel
          days={monthDays}
          selectedDate={selectedDate}
          visibleYear={visibleYear}
          visibleMonth={visibleMonth}
          onSelectDate={(date) => void loadDay(date)}
          onShiftMonth={shiftMonth}
        />

        <section className="sync-card">
          <label className="field">
            <span>分析日期</span>
            <input type="date" value={selectedDate} onChange={(event) => void loadDay(event.target.value)} />
          </label>
          <div className="button-row">
            <button className="secondary-button" onClick={() => void loadDay(todayIso())} disabled={isScanning}>
              今天
            </button>
            <button className="secondary-button" onClick={() => void refreshDashboard()} disabled={isScanning || isLoading}>
              刷新
            </button>
          </div>
          <button className="primary-button" onClick={() => void scanHistory()} disabled={isScanning}>
            {isScanning ? "读取中..." : "读取浏览记录"}
          </button>
          {lastScan ? <ScanMeta result={lastScan} /> : null}
        </section>

        <div className="status-banner" data-tone={status.tone}>
          {status.message}
        </div>
      </aside>

      <section className="content-pane">
        <header className="content-header">
          <div>
            <p className="eyebrow">当天浏览行为</p>
            <h2>{selectedDate}</h2>
          </div>
          <div className="header-actions">
            <button className="ghost-button" onClick={() => void copySummary()} disabled={!digest}>
              复制摘要
            </button>
            <nav className="view-switcher" aria-label="看板视图">
              {views.map((view) => (
                <button
                  key={view.key}
                  className="view-button"
                  aria-current={activeView === view.key ? "page" : undefined}
                  data-active={String(activeView === view.key)}
                  onClick={() => setActiveView(view.key)}
                >
                  {view.label}
                </button>
              ))}
            </nav>
          </div>
        </header>

        <section className="view-panel" aria-busy={isLoading}>
          {isLoading ? <LoadingCard /> : digest ? <DashboardView dashboard={digest.dashboard} activeView={activeView} setActiveView={setActiveView} /> : <EmptyCard title="暂无看板数据" />}
        </section>
      </section>
    </main>
  );
}

function CalendarPanel({
  days,
  selectedDate,
  visibleYear,
  visibleMonth,
  onSelectDate,
  onShiftMonth
}: {
  days: CalendarDay[];
  selectedDate: string;
  visibleYear: number;
  visibleMonth: number;
  onSelectDate: (date: string) => void;
  onShiftMonth: (delta: number) => void;
}) {
  const firstWeekday = new Date(visibleYear, visibleMonth - 1, 1).getDay();

  return (
    <section className="calendar-card">
      <div className="month-nav">
        <button className="icon-button" aria-label="上个月" onClick={() => onShiftMonth(-1)}>
          ‹
        </button>
        <strong>{monthTitle(visibleYear, visibleMonth)}</strong>
        <button className="icon-button" aria-label="下个月" onClick={() => onShiftMonth(1)}>
          ›
        </button>
      </div>
      <div className="weekday-row">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {Array.from({ length: firstWeekday }, (_, index) => (
          <div className="calendar-spacer" key={`spacer-${index}`} />
        ))}
        {days.map((day) => (
          <button
            key={day.date}
            className="calendar-day"
            data-selected={String(day.date === selectedDate)}
            data-has-signal={String(day.signalCount > 0)}
            title={`${day.date}，${day.visitCount} 条浏览记录`}
            onClick={() => onSelectDate(day.date)}
          >
            <span className="day-number">{day.day}</span>
            <span className="day-dot">{day.signalCount ? "•" : ""}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ScanMeta({ result }: { result: ScanResult }) {
  return (
    <div className="scan-meta">
      <span>{result.availableBrowsers.length ? `已识别：${result.availableBrowsers.join("、")}` : "未发现可读取的浏览器历史文件"}</span>
      {result.errors.length ? <span data-tone="warn">{result.errors.length} 个来源读取失败</span> : null}
    </div>
  );
}

function DashboardView({
  dashboard,
  activeView,
  setActiveView
}: {
  dashboard: BrowserDashboard;
  activeView: ViewKey;
  setActiveView: (view: ViewKey) => void;
}) {
  if (activeView === "overview") return <Overview dashboard={dashboard} setActiveView={setActiveView} />;
  if (activeView === "sites") return <RankingList title="网站浏览时长" items={dashboard.siteDurationRanking} value={(item) => item.durationText} />;
  if (activeView === "pages") return <RankingList title="单页面占比" items={dashboard.pageDurationRanking} value={(item) => `${item.durationText} · ${item.percentage}%`} />;
  if (activeView === "visits") return <VisitRankingCard title="网站访问次数" items={dashboard.siteVisitRanking} />;
  if (activeView === "timeline") return <TimelineCard title="访问时间线" items={dashboard.timeline} />;
  return <RawTable items={dashboard.rawVisits} />;
}

function Overview({ dashboard, setActiveView }: { dashboard: BrowserDashboard; setActiveView: (view: ViewKey) => void }) {
  const topSite = dashboard.siteDurationRanking[0];
  const topPage = dashboard.pageDurationRanking[0];
  const activeHour = dashboard.hourlyDuration.reduce((best, item) => (item.duration > best.duration ? item : best), dashboard.hourlyDuration[0]);

  return (
    <div className="dashboard">
      <section className="summary-card">
        <p>{dashboard.summary}</p>
      </section>

      <section className="kpi-grid" aria-label="今日关键指标">
        <KpiCard label="有效浏览时长" value={dashboard.totalDurationText} hint="已校准异常重叠时长" />
        <KpiCard label="浏览记录" value={`${dashboard.visitCount} 条`} hint="按真实访问序列统计" />
        <KpiCard label="主要网站" value={topSite?.domain || "暂无"} hint={topSite?.durationText || "暂无数据"} />
        <KpiCard label="活跃时段" value={activeHour?.duration ? activeHour.label : "暂无"} hint={activeHour?.durationText || "暂无数据"} />
      </section>

      <section className="dashboard-grid">
        <div className="main-column">
          <section className="visual-card trend-card">
            <div className="card-title">
              <div>
                <h3>小时浏览强度</h3>
                <p>按小时汇总当天有效浏览时长</p>
              </div>
              <strong>{dashboard.totalDurationText}</strong>
            </div>
            <HourlyChart dashboard={dashboard} />
          </section>
          <TimelineCard title="最近访问线索" items={dashboard.timeline.slice(0, 5)} compact onOpenAll={() => setActiveView("timeline")} />
        </div>

        <aside className="side-column">
          <section className="visual-card">
            <div className="card-title">
              <div>
                <h3>单页面占比</h3>
                <p>{topPage ? `最高：${topPage.percentage}%` : "暂无页面数据"}</p>
              </div>
              <button className="text-button" onClick={() => setActiveView("pages")}>
                全部
              </button>
            </div>
            <PageShareChart items={dashboard.pageDurationRanking.slice(0, 5)} totalDurationText={dashboard.totalDurationText} />
          </section>
          <VisitRankingCard title="访问次数排行" items={dashboard.siteVisitRanking.slice(0, 6)} onOpenAll={() => setActiveView("visits")} />
        </aside>
      </section>
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="kpi-card">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function HourlyChart({ dashboard }: { dashboard: BrowserDashboard }) {
  const scale = dashboard.totalDuration >= 60000 ? 60000 : 1000;
  const unit = dashboard.totalDuration >= 60000 ? "分钟" : "秒";
  const option = useMemo(
    () => ({
      grid: { top: 18, right: 10, bottom: 24, left: 34 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const point = Array.isArray(params) ? (params[0] as { dataIndex: number }) : ({ dataIndex: 0 } as { dataIndex: number });
          const item = dashboard.hourlyDuration[point.dataIndex];
          return `${item.label}<br/>时长：${item.durationText}<br/>访问：${item.visitCount} 次`;
        }
      },
      xAxis: {
        type: "category",
        data: dashboard.hourlyDuration.map((item) => String(item.hour).padStart(2, "0")),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#e4e7ec" } },
        axisLabel: { color: "#667085", interval: 2 }
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: "#667085" },
        splitLine: { lineStyle: { color: "#eef2f7" } }
      },
      series: [
        {
          type: "bar",
          name: unit,
          data: dashboard.hourlyDuration.map((item) => Math.round(item.duration / scale)),
          itemStyle: { color: "#2f6fed", borderRadius: [7, 7, 2, 2] },
          emphasis: { itemStyle: { color: "#1f5fd8" } },
          barMaxWidth: 24
        }
      ]
    }),
    [dashboard.hourlyDuration, scale, unit]
  );

  return dashboard.visitCount ? <Chart option={option} className="chart chart-hourly" /> : <EmptyInline message="读取浏览记录后显示小时分布。" />;
}

function PageShareChart({ items, totalDurationText }: { items: RankingItem[]; totalDurationText: string }) {
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2"];
  const option = useMemo(
    () => ({
      color: colors,
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["55%", "78%"],
          center: ["38%", "50%"],
          avoidLabelOverlap: true,
          label: { show: false },
          data: items.map((item) => ({ name: item.title || item.domain, value: item.percentage }))
        }
      ],
      graphic: [
        { type: "text", left: "31%", top: "43%", style: { text: "总计", fill: "#667085", fontSize: 12, textAlign: "center" } },
        { type: "text", left: "25%", top: "52%", style: { text: totalDurationText, fill: "#101828", fontSize: 12, fontWeight: 800 } }
      ]
    }),
    [items, totalDurationText]
  );

  if (!items.length) return <EmptyInline message="暂无可展示的页面占比。" />;

  return (
    <div className="share-body">
      <Chart option={option} className="chart chart-donut" />
      <div className="share-legend">
        {items.map((item, index) => (
          <article key={`${item.domain}-${item.title || index}`}>
            <i style={{ background: colors[index] }} />
            <div>
              <strong title={item.title || item.domain}>{item.title || item.domain}</strong>
              <small>{item.domain}</small>
            </div>
            <b>{item.percentage}%</b>
          </article>
        ))}
      </div>
    </div>
  );
}

function Chart({ option, className }: { option: EChartsCoreOption; className: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.setOption(option, true);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div ref={ref} className={className} />;
}

function VisitRankingCard({ title, items, onOpenAll }: { title: string; items: RankingItem[]; onOpenAll?: () => void }) {
  return (
    <section className="visual-card">
      <div className="card-title">
        <div>
          <h3>{title}</h3>
          <p>看出高频网站，即使原始时长为 0 也保留访问次数</p>
        </div>
        {onOpenAll ? (
          <button className="text-button" onClick={onOpenAll}>
            全部
          </button>
        ) : null}
      </div>
      <VisitRanking items={items} />
    </section>
  );
}

function VisitRanking({ items }: { items: RankingItem[] }) {
  if (!items.length) return <EmptyInline message="暂无可展示的访问排行。" />;
  const max = Math.max(...items.map((item) => item.visitCount), 1);

  return (
    <div className="visit-ranking">
      {items.map((item) => (
        <article key={item.domain}>
          <div>
            <strong title={item.domain}>{item.domain}</strong>
            <small>{item.durationText}</small>
          </div>
          <span>{item.visitCount}</span>
          <div className="rank-track">
            <i style={{ width: `${Math.max(4, Math.round((item.visitCount / max) * 100))}%` }} />
          </div>
        </article>
      ))}
    </div>
  );
}

function RankingList({ title, items, value }: { title: string; items: RankingItem[]; value: (item: RankingItem) => string }) {
  if (!items.length) return <EmptyCard title={title} />;
  const maxPercent = Math.max(...items.map((item) => item.percentage), 1);

  return (
    <section className="visual-card list-card">
      <h3>{title}</h3>
      <div className="bar-list">
        {items.map((item, index) => (
          <article className="bar-row" key={`${item.domain}-${item.title || index}`}>
            <span className="rank">{index + 1}</span>
            <div className="bar-main">
              <div className="bar-head">
                <strong title={item.title || item.domain}>{item.title || item.domain}</strong>
                <span>{value(item)}</span>
              </div>
              <div className="bar-track">
                <span style={{ width: `${Math.max(2, Math.round((item.percentage / maxPercent) * 100))}%` }} />
              </div>
              <small>{item.title ? `${item.domain} · ${item.visitCount} 次访问` : `${item.visitCount} 次访问 · 占总时长 ${item.percentage}%`}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TimelineCard({
  title,
  items,
  compact,
  onOpenAll
}: {
  title: string;
  items: TimelineItem[];
  compact?: boolean;
  onOpenAll?: () => void;
}) {
  return (
    <section className="visual-card timeline-card" data-compact={String(Boolean(compact))}>
      <div className="card-title">
        <div>
          <h3>{title}</h3>
          <p>按真实访问顺序排列，敏感标题会自动隐藏</p>
        </div>
        {compact && onOpenAll ? (
          <button className="text-button" onClick={onOpenAll}>
            全部
          </button>
        ) : null}
      </div>
      <TimelineList items={items} />
    </section>
  );
}

function TimelineList({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <EmptyInline message="暂无可展示的时间线。" />;

  return (
    <div className="timeline-visual">
      {items.map((item) => (
        <article className="timeline-row" key={item.id}>
          <time>{item.timeLabel}</time>
          <span className="timeline-dot" />
          <div>
            <strong title={item.title}>{item.title}</strong>
            <small>
              {item.domain} · {item.hasDuration ? item.durationText : "无时长记录"}
              {item.durationWasCapped ? " · 已校准" : ""}
            </small>
          </div>
        </article>
      ))}
    </div>
  );
}

function RawTable({ items }: { items: TimelineItem[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((item) => `${item.title} ${item.domain} ${item.browser || ""} ${item.profile || ""}`.toLowerCase().includes(normalizedQuery))
    : items;

  if (!items.length) return <EmptyCard title="原始访问明细" />;

  return (
    <section className="visual-card list-card">
      <div className="table-toolbar">
        <div>
          <h3>原始访问明细</h3>
          <p>{filteredItems.length} 条匹配，最多显示 260 条</p>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选标题、网站或浏览器" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>网站</th>
              <th>标题</th>
              <th>时长</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.slice(0, 260).map((item) => (
              <tr key={item.id}>
                <td>{item.timeLabel}</td>
                <td>{item.domain}</td>
                <td>{item.title}</td>
                <td>{item.durationWasCapped ? `${item.durationText}（原始 ${item.rawDurationText}）` : item.durationText}</td>
                <td>{[item.browser, item.profile].filter(Boolean).join(" / ") || "浏览器"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LoadingCard() {
  return (
    <section className="visual-card empty-card">
      <span className="loading-dot" />
      <h3>正在加载看板</h3>
      <p className="muted">正在读取本机缓存并生成当天浏览摘要。</p>
    </section>
  );
}

function EmptyInline({ message }: { message: string }) {
  return <p className="muted empty-inline">{message}</p>;
}

function EmptyCard({ title }: { title: string }) {
  return (
    <section className="visual-card empty-card">
      <h3>{title}</h3>
      <p className="muted">暂无可展示的数据。读取浏览记录后再刷新看板。</p>
    </section>
  );
}
