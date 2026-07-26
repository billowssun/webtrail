import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArrowClockwise, ArrowSquareOut, CalendarBlank, CaretDown, CaretLeft,
  CaretRight, CaretUp, ChartBar, Check, Clock, ClockCounterClockwise, Database,
  DotsThree, DownloadSimple, Export, Funnel, GearSix, Globe, HardDrives,
  ListBullets, MagnifyingGlass, Rows, ShieldCheck, Stack, Tag, Trash,
  UploadSimple, X
} from "@phosphor-icons/react";
import {
  deleteArchivedVisits, downloadBlob, ensureDemoArchive, exportArchiveJson,
  faviconUrl, getArchiveStats, getArchiveStatus, importArchiveFile, isExtension,
  queryVisits, sendExtensionMessage, type ArchivedVisit, type ArchiveStatus
} from "./archiveDb";
import {
  buildSessions, domainRanking, formatDate, formatSpan, formatTime, hourlyCounts,
  type VisitSession
} from "./historyModel";

type ViewKey = "timeline" | "sessions" | "pages" | "search" | "domains" | "settings";
type Notice = { tone: "info" | "success" | "warning" | "error"; text: string };

const DAY = 24 * 60 * 60 * 1000;
const TODAY = localDate(new Date());
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function localDate(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function dayRange(date: string) {
  const start = new Date(`${date}T00:00:00`).getTime();
  return { startTime: start, endTime: start + DAY };
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function transitionText(value: string) {
  const labels: Record<string, string> = {
    link: "链接", typed: "手动输入", auto_bookmark: "书签/推荐",
    auto_subframe: "子框架", manual_subframe: "手动框架", generated: "搜索",
    auto_toplevel: "自动导航", form_submit: "表单提交", reload: "重新加载",
    keyword: "关键词", keyword_generated: "关键词生成"
  };
  return labels[value] || value || "访问";
}

export default function App() {
  const [view, setView] = useState<ViewKey>("timeline");
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [calendarMonth, setCalendarMonth] = useState(() => TODAY.slice(0, 7));
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeHour, setActiveHour] = useState<number | null>(null);
  const [visits, setVisits] = useState<ArchivedVisit[]>([]);
  const [monthVisits, setMonthVisits] = useState<ArchivedVisit[]>([]);
  const [status, setStatus] = useState<ArchiveStatus>({ phase: "idle" });
  const [stats, setStats] = useState({ count: 0, oldest: null as number | null, newest: null as number | null, usage: 0, quota: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice>({ tone: "info", text: isExtension ? "全部记录只保存在本机。" : "开发预览使用本地示例归档。" });
  const [moreOpen, setMoreOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    void ensureDemoArchive().then(refresh);
    if (!isExtension) return;
    const listener = (message: { type?: string; status?: ArchiveStatus }) => {
      if (message.type === "ARCHIVE_CHANGED") refresh();
      if (message.type === "ARCHIVE_STATUS_CHANGED" && message.status) {
        setStatus(message.status);
        refresh();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  useEffect(() => {
    let canceled = false;
    async function load() {
      setLoading(true);
      try {
        const range = dayRange(selectedDate);
        const useArchiveRange = Boolean(debouncedSearch) || view === "search" || view === "domains" || view === "settings";
        const [nextVisits, nextStatus, nextStats] = await Promise.all([
          queryVisits({
            startTime: useArchiveRange ? 0 : range.startTime,
            endTime: useArchiveRange ? Date.now() + 1 : range.endTime,
            text: debouncedSearch,
            limit: useArchiveRange ? 50000 : 20000
          }),
          getArchiveStatus(),
          getArchiveStats()
        ]);
        if (!canceled) {
          setVisits(nextVisits);
          setStatus(nextStatus);
          setStats(nextStats);
        }
      } catch (error) {
        if (!canceled) setNotice({ tone: "error", text: `读取归档失败：${(error as Error).message}` });
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    return () => { canceled = true; };
  }, [debouncedSearch, refreshKey, selectedDate, view]);

  useEffect(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    const startTime = new Date(year, month - 1, 1).getTime();
    const endTime = new Date(year, month, 1).getTime();
    void queryVisits({ startTime, endTime, limit: 50000 }).then(setMonthVisits);
  }, [calendarMonth, refreshKey]);

  const dayVisits = useMemo(() => {
    if (debouncedSearch || view === "search" || view === "domains" || view === "settings") return visits;
    return activeHour === null
      ? visits
      : visits.filter((visit) => new Date(visit.visitTime).getHours() === activeHour);
  }, [activeHour, debouncedSearch, view, visits]);
  const sessions = useMemo(() => buildSessions(dayVisits), [dayVisits]);
  const dayAllHours = useMemo(() => hourlyCounts(visits), [visits]);
  const ranking = useMemo(() => domainRanking(dayVisits), [dayVisits]);
  const selectedVisits = useMemo(() => dayVisits.filter((visit) => selected.has(visit.id)), [dayVisits, selected]);

  useEffect(() => {
    setSelected(new Set());
  }, [selectedDate, activeHour, debouncedSearch, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sessions.length) return;
    setExpanded((current) => current.size
      ? current
      : new Set(sessions.slice(0, 4).map((session) => session.id)));
  }, [sessions]);

  function chooseDate(date: string) {
    setSelectedDate(date);
    setCalendarMonth(date.slice(0, 7));
    setActiveHour(null);
    if (view === "search" || view === "domains" || view === "settings") setView("timeline");
  }

  function moveDay(offset: number) {
    const date = new Date(`${selectedDate}T12:00:00`);
    date.setDate(date.getDate() + offset);
    chooseDate(localDate(date));
  }

  function toggleVisit(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSession(session: VisitSession) {
    setSelected((current) => {
      const next = new Set(current);
      const everySelected = session.visits.every((visit) => next.has(visit.id));
      session.visits.forEach((visit) => everySelected ? next.delete(visit.id) : next.add(visit.id));
      return next;
    });
  }

  async function openSelected() {
    const urls = Array.from(new Set(selectedVisits.map((visit) => visit.url)));
    if (!urls.length) return;
    if (isExtension) {
      await sendExtensionMessage({ type: "OPEN_URLS", urls });
    } else {
      urls.slice(0, 3).forEach((url) => window.open(url, "_blank", "noopener"));
    }
    setNotice({ tone: "success", text: `已重新打开 ${Math.min(urls.length, 30)} 个页面。` });
  }

  function exportSelected() {
    const source = selectedVisits.length ? selectedVisits : dayVisits;
    const rows = [["时间", "标题", "URL", "域名", "导航类型", "归档来源"]];
    source.forEach((visit) => rows.push([
      new Date(visit.visitTime).toISOString(),
      visit.title,
      visit.url,
      visit.domain,
      visit.transition,
      visit.source
    ]));
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    downloadBlob(`\uFEFF${csv}`, `webtrail-${selectedDate}.csv`, "text/csv;charset=utf-8");
    setNotice({ tone: "success", text: `已导出 ${source.length} 条记录。` });
  }

  async function deleteFromChrome() {
    const source = selectedVisits.length ? selectedVisits : [];
    const urls = Array.from(new Set(source.filter((visit) => visit.nativePresent).map((visit) => visit.url)));
    if (!urls.length) return setNotice({ tone: "warning", text: "所选记录已不在 Chrome 原生历史中。" });
    if (!window.confirm(`从 Chrome 原生历史删除 ${urls.length} 个 URL？永久归档仍会保留。`)) return;
    const result = await sendExtensionMessage<{ ok: boolean; error?: string }>({ type: "DELETE_NATIVE", urls });
    setNotice(result.ok ? { tone: "success", text: "已从 Chrome 删除；Webtrail 永久归档仍保留。" } : { tone: "error", text: result.error || "删除失败" });
    refresh();
  }

  async function deleteFromArchive() {
    const ids = selectedVisits.map((visit) => visit.id);
    if (!ids.length || !window.confirm(`永久删除 ${ids.length} 条 Webtrail 归档？此操作不可恢复。`)) return;
    await deleteArchivedVisits(ids);
    setSelected(new Set());
    setNotice({ tone: "success", text: `已永久删除 ${ids.length} 条归档。` });
    refresh();
  }

  async function syncNow() {
    setSyncing(true);
    const result = await sendExtensionMessage<{ ok: boolean; error?: string }>({ type: "SYNC_NOW" });
    setSyncing(false);
    setNotice(result.ok ? { tone: "success", text: "已同步最近 3 天的 Chrome 历史。" } : { tone: "error", text: result.error || "同步失败" });
    refresh();
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      const count = await importArchiveFile(file);
      setNotice({ tone: "success", text: `成功导入 ${count} 条历史归档。` });
      refresh();
    } catch (error) {
      setNotice({ tone: "error", text: `导入失败：${(error as Error).message}` });
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  const archiveProgress = status.importStart && status.importCursor
    ? Math.max(0, Math.min(100, Math.round(((Date.now() - status.importCursor) / (Date.now() - status.importStart)) * 100)))
    : status.bootstrapComplete ? 100 : 0;

  return (
    <div className="atlas-app">
      <Sidebar view={view} setView={setView} stats={stats} status={status} />
      <div className="atlas-main">
        <Topbar
          search={search}
          setSearch={(value) => { setSearch(value); if (value) setView("search"); }}
          selectedDate={selectedDate}
          chooseDate={chooseDate}
          moveDay={moveDay}
          chooseToday={() => chooseDate(TODAY)}
          selectedCount={selected.size}
          onOpen={() => void openSelected()}
          onExport={exportSelected}
          onDelete={() => void deleteFromChrome()}
          moreOpen={moreOpen}
          setMoreOpen={setMoreOpen}
          onSync={() => void syncNow()}
          syncing={syncing}
          onImport={() => importRef.current?.click()}
          onExportArchive={() => void exportArchiveJson()}
          onDeleteArchive={() => void deleteFromArchive()}
        />
        <input ref={importRef} className="visually-hidden" type="file" accept=".json,.csv" onChange={(event) => void importFile(event.target.files?.[0])} />
        <div className="notice-line" data-tone={notice.tone}><ShieldCheck size={14} weight="fill" /><span>{notice.text}</span></div>
        {view !== "settings" && view !== "domains" ? (
          <HourScrubber
            date={selectedDate}
            buckets={dayAllHours}
            activeHour={activeHour}
            onHour={(hour) => setActiveHour((current) => current === hour ? null : hour)}
          />
        ) : null}
        <div className="atlas-content">
          <main className="timeline-pane">
            {view === "settings" ? (
              <SettingsPanel stats={stats} status={status} onImport={() => importRef.current?.click()} onExport={() => void exportArchiveJson()} onSync={() => void syncNow()} />
            ) : view === "domains" ? (
              <DomainView ranking={ranking} total={dayVisits.length} onDomain={(domain) => { setSearch(domain); setView("search"); }} />
            ) : view === "pages" || view === "search" ? (
              <PageList visits={dayVisits} selected={selected} onToggle={toggleVisit} loading={loading} />
            ) : (
              <SessionTimeline
                sessions={sessions}
                selected={selected}
                expanded={expanded}
                setExpanded={setExpanded}
                onToggleVisit={toggleVisit}
                onToggleSession={toggleSession}
                loading={loading}
                searchMode={Boolean(debouncedSearch)}
              />
            )}
          </main>
          <RightRail
            selectedDate={selectedDate}
            month={calendarMonth}
            setMonth={setCalendarMonth}
            monthVisits={monthVisits}
            chooseDate={chooseDate}
            stats={stats}
            status={status}
            archiveProgress={archiveProgress}
            visitCount={dayVisits.length}
            sessions={sessions}
            ranking={ranking}
          />
        </div>
      </div>
    </div>
  );
}

function Sidebar({ view, setView, stats, status }: {
  view: ViewKey;
  setView: (view: ViewKey) => void;
  stats: { count: number; oldest: number | null; usage: number };
  status: ArchiveStatus;
}) {
  const items: Array<{ key: ViewKey; label: string; icon: React.ReactNode; section?: string }> = [
    { key: "timeline", label: "时间线", icon: <ClockCounterClockwise size={18} /> },
    { key: "sessions", label: "会话", icon: <Stack size={18} /> },
    { key: "pages", label: "所有页面", icon: <Rows size={18} /> },
    { key: "search", label: "搜索历史", icon: <MagnifyingGlass size={18} /> },
    { key: "domains", label: "按域名", icon: <Globe size={18} />, section: "分析" },
    { key: "domains", label: "按标签", icon: <Tag size={18} /> },
    { key: "domains", label: "按类型", icon: <ListBullets size={18} /> },
    { key: "settings", label: "规则与过滤", icon: <Funnel size={18} />, section: "管理" },
    { key: "settings", label: "设置", icon: <GearSix size={18} /> }
  ];
  return <aside className="atlas-sidebar">
    <div className="atlas-brand">
      <img src="./icons/icon-48.png" alt="" />
      <div><strong>Webtrail</strong><span>本地永久归档 <i data-live={status.phase !== "error"} /></span></div>
    </div>
    <nav>
      <p>浏览</p>
      {items.map((item, index) => <div key={`${item.label}-${index}`}>
        {item.section ? <p className="nav-section">{item.section}</p> : null}
        <button data-active={view === item.key && (index < 5 || item.label === "设置")} onClick={() => setView(item.key)}>
          {item.icon}<span>{item.label}</span>
        </button>
      </div>)}
    </nav>
    <div className="archive-summary">
      <header><ShieldCheck size={19} weight="fill" /><strong>本地永久归档</strong></header>
      <p>{stats.oldest ? `${formatDate(stats.oldest)} — 今天` : "等待首次导入"}</p>
      <strong>{stats.count.toLocaleString("zh-CN")} <small>条记录</small></strong>
      <span>{formatBytes(stats.usage)} · 仅存此设备</span>
    </div>
  </aside>;
}

function Topbar(props: {
  search: string; setSearch: (value: string) => void; selectedDate: string; chooseDate: (date: string) => void; moveDay: (offset: number) => void;
  chooseToday: () => void; selectedCount: number; onOpen: () => void; onExport: () => void; onDelete: () => void;
  moreOpen: boolean; setMoreOpen: (value: boolean) => void; onSync: () => void; syncing: boolean;
  onImport: () => void; onExportArchive: () => void; onDeleteArchive: () => void;
}) {
  return <header className="atlas-topbar">
    <label className="command-search"><MagnifyingGlass size={18} /><input value={props.search} onChange={(event) => props.setSearch(event.target.value)}
      placeholder="搜索标题、网址或关键词" autoFocus /><kbd>⌘ K</kbd>{props.search ? <button onClick={() => props.setSearch("")}><X size={14} /></button> : null}</label>
    <div className="topbar-spacer" />
    <div className="date-command"><CalendarBlank size={17} /><input type="date" value={props.selectedDate} onChange={(event) => event.target.value && props.chooseDate(event.target.value)} />
      <button onClick={() => props.moveDay(-1)}><CaretLeft size={16} /></button></div>
    <button className="top-button" onClick={props.chooseToday}>今天</button>
    <button className="top-button" disabled={!props.selectedCount} onClick={props.onOpen}><ArrowSquareOut size={16} />打开所选</button>
    <button className="top-button" onClick={props.onExport}><Export size={16} />导出{props.selectedCount ? ` ${props.selectedCount}` : ""}</button>
    <button className="top-button danger" disabled={!props.selectedCount} onClick={props.onDelete}><Trash size={16} />从 Chrome 移除</button>
    <div className="more-wrap"><button className="icon-button" onClick={() => props.setMoreOpen(!props.moreOpen)}><DotsThree size={20} /></button>
      {props.moreOpen ? <div className="more-menu">
        <button onClick={props.onSync}><ArrowClockwise size={16} className={props.syncing ? "spin" : ""} />立即同步</button>
        <button onClick={props.onImport}><UploadSimple size={16} />导入旧归档</button>
        <button onClick={props.onExportArchive}><DownloadSimple size={16} />备份全部归档</button>
        <button className="danger" disabled={!props.selectedCount} onClick={props.onDeleteArchive}><Trash size={16} />从永久归档删除</button>
      </div> : null}
    </div>
  </header>;
}

function HourScrubber({ date, buckets, activeHour, onHour }: {
  date: string; buckets: Array<{ hour: number; count: number }>; activeHour: number | null; onHour: (hour: number) => void;
}) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return <section className="hour-scrubber">
    <strong>{new Date(`${date}T12:00:00`).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</strong>
    <div className="hour-axis">
      {buckets.map((bucket) => <button key={bucket.hour} data-active={activeHour === bucket.hour} onClick={() => onHour(bucket.hour)}
        title={`${String(bucket.hour).padStart(2, "0")}:00 · ${bucket.count} 次访问`}>
        <i style={{ height: `${Math.max(2, (bucket.count / max) * 30)}px` }} /><span>{bucket.hour % 2 === 0 ? `${String(bucket.hour).padStart(2, "0")}:00` : ""}</span>
      </button>)}
    </div>
    <span className="jump-label"><Clock size={15} />点击跳转到小时</span>
  </section>;
}

function SessionTimeline({ sessions, selected, expanded, setExpanded, onToggleVisit, onToggleSession, loading, searchMode }: {
  sessions: VisitSession[]; selected: Set<string>; expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  onToggleVisit: (id: string) => void; onToggleSession: (session: VisitSession) => void; loading: boolean; searchMode: boolean;
}) {
  if (loading) return <LoadingTimeline />;
  if (!sessions.length) return <EmptyArchive searchMode={searchMode} />;
  return <div className="session-timeline">
    <div className="pane-heading"><div><h1>{searchMode ? "搜索结果" : "会话视图"}</h1><span>{sessions.length} 个会话 · 时间为访问跨度，不代表活跃时长</span></div>
      <button><Funnel size={15} />筛选</button></div>
    {sessions.slice(0, 120).map((session) => {
      const isExpanded = expanded.has(session.id);
      const everySelected = session.visits.every((visit) => selected.has(visit.id));
      return <article className="session-block" key={session.id}>
        <div className="session-time-rail"><strong>{formatTime(session.start)}</strong><i /><span /></div>
        <div className="session-surface">
          <header>
            <button className="check-button" data-checked={everySelected} onClick={() => onToggleSession(session)}>{everySelected ? <Check size={12} weight="bold" /> : null}</button>
            <div><strong>{session.title}</strong><span>{formatTime(session.start)}–{formatTime(session.end)} · 跨度 {formatSpan(session.span)}</span></div>
            <small>{session.visits.length} 个页面</small>
            <button className="collapse-button" onClick={() => setExpanded((current) => {
              const next = new Set(current); if (next.has(session.id)) next.delete(session.id); else next.add(session.id); return next;
            })}>{isExpanded ? <CaretUp size={15} /> : <CaretDown size={15} />}</button>
          </header>
          {isExpanded ? <div className="session-pages">{session.visits.slice().reverse().map((visit, index, array) =>
            <VisitRow key={visit.id} visit={visit} selected={selected.has(visit.id)} onToggle={() => onToggleVisit(visit.id)}
              nextTime={array[index + 1]?.visitTime} />)}</div> : null}
          {!isExpanded ? <div className="domain-preview">{session.domains.slice(0, 5).map((domain) => <span key={domain}>{domain}</span>)}</div> : null}
        </div>
      </article>;
    })}
  </div>;
}

function VisitRow({ visit, selected, onToggle, nextTime }: { visit: ArchivedVisit; selected: boolean; onToggle: () => void; nextTime?: number }) {
  const gap = nextTime ? Math.max(0, visit.visitTime - nextTime) : 0;
  const favicon = faviconUrl(visit.url);
  return <div className="visit-row" data-selected={selected}>
    <button className="check-button" data-checked={selected} onClick={onToggle}>{selected ? <Check size={12} weight="bold" /> : null}</button>
    <span className="visit-clock">{formatTime(visit.visitTime)}</span>
    {favicon ? <img className="favicon" src={favicon} alt="" /> : <span className="favicon fallback">{visit.domain.charAt(0).toUpperCase()}</span>}
    <a href={visit.url} target="_blank" rel="noreferrer"><strong>{visit.title}</strong><span>{visit.url.replace(/^https?:\/\//, "")}</span></a>
    <span className="visit-type">{transitionText(visit.transition)}</span>
    <span className="visit-gap">{gap ? `间隔 ${formatSpan(gap)}` : "会话末项"}</span>
    <span className="archive-badge" data-native={visit.nativePresent}>{visit.nativePresent ? "Chrome + 归档" : "仅归档"}</span>
  </div>;
}

function PageList({ visits, selected, onToggle, loading }: { visits: ArchivedVisit[]; selected: Set<string>; onToggle: (id: string) => void; loading: boolean }) {
  if (loading) return <LoadingTimeline />;
  if (!visits.length) return <EmptyArchive searchMode />;
  return <div className="flat-pages">
    <div className="pane-heading"><div><h1>所有页面</h1><span>{visits.length.toLocaleString("zh-CN")} 条匹配记录</span></div></div>
    {visits.slice(0, 5000).map((visit) => <VisitRow key={visit.id} visit={visit} selected={selected.has(visit.id)} onToggle={() => onToggle(visit.id)} />)}
  </div>;
}

function DomainView({ ranking, total, onDomain }: { ranking: Array<{ domain: string; count: number }>; total: number; onDomain: (domain: string) => void }) {
  const max = ranking[0]?.count || 1;
  return <div className="domain-view">
    <div className="pane-heading"><div><h1>域名视图</h1><span>{ranking.length} 个域名 · {total.toLocaleString("zh-CN")} 条归档</span></div></div>
    <div className="domain-table">{ranking.slice(0, 200).map((item, index) => <button key={item.domain} onClick={() => onDomain(item.domain)}>
      <span>{String(index + 1).padStart(2, "0")}</span><strong>{item.domain}</strong><i><b style={{ width: `${(item.count / max) * 100}%` }} /></i>
      <em>{item.count.toLocaleString("zh-CN")} 次</em><CaretRight size={15} />
    </button>)}</div>
  </div>;
}

function SettingsPanel({ stats, status, onImport, onExport, onSync }: {
  stats: { count: number; oldest: number | null; newest: number | null; usage: number; quota: number };
  status: ArchiveStatus; onImport: () => void; onExport: () => void; onSync: () => void;
}) {
  return <div className="settings-view">
    <div className="pane-heading"><div><h1>归档设置</h1><span>永久归档独立于 Chrome 原生历史</span></div></div>
    <section><header><Database size={20} /><div><strong>本地 IndexedDB 归档</strong><span>扩展卸载前永久保留，不随 Chrome 清理历史而删除</span></div><b data-good>已启用</b></header>
      <dl><div><dt>归档记录</dt><dd>{stats.count.toLocaleString("zh-CN")} 条</dd></div><div><dt>覆盖范围</dt><dd>{stats.oldest ? `${formatDate(stats.oldest)} — ${formatDate(stats.newest || Date.now())}` : "暂无"}</dd></div>
        <div><dt>占用空间</dt><dd>{formatBytes(stats.usage)}</dd></div><div><dt>初次深度导入</dt><dd>{status.bootstrapComplete ? "已完成" : status.phase === "importing" ? "进行中" : "等待"}</dd></div></dl></section>
    <section><header><HardDrives size={20} /><div><strong>迁移与备份</strong><span>导入旧 Webtrail JSON/CSV，或备份全部永久归档</span></div></header>
      <div className="settings-actions"><button onClick={onImport}><UploadSimple size={17} />导入归档</button><button onClick={onExport}><DownloadSimple size={17} />备份全部</button>
        <button onClick={onSync}><ArrowClockwise size={17} />同步最近历史</button></div></section>
    <section><header><ShieldCheck size={20} /><div><strong>隐私边界</strong><span>不上传记录，不注入网页，不读取页面内容；仅使用 Chrome history 权限</span></div></header></section>
  </div>;
}

function RightRail(props: {
  selectedDate: string; month: string; setMonth: (month: string) => void; monthVisits: ArchivedVisit[];
  chooseDate: (date: string) => void; stats: { count: number; oldest: number | null; usage: number };
  status: ArchiveStatus; archiveProgress: number; visitCount: number; sessions: VisitSession[]; ranking: Array<{ domain: string; count: number }>;
}) {
  return <aside className="right-rail">
    <div className="rail-title">时间洞察</div>
    <CalendarPanel selectedDate={props.selectedDate} month={props.month} setMonth={props.setMonth} visits={props.monthVisits} chooseDate={props.chooseDate} />
    <section className="rail-card archive-coverage">
      <header><Archive size={17} /><strong>永久归档覆盖</strong></header>
      <p>{props.stats.oldest ? `${formatDate(props.stats.oldest)} — 今天` : "正在导入 Chrome 历史"}</p>
      <div className="coverage-track"><i style={{ width: `${props.archiveProgress}%` }} /></div>
      <div><span>{props.status.bootstrapComplete ? "深度导入完成" : `深度导入 ${props.archiveProgress}%`}</span><b>{props.stats.count.toLocaleString("zh-CN")} 条</b></div>
      <small><ShieldCheck size={13} weight="fill" />本地永久存储 · {formatBytes(props.stats.usage)}</small>
    </section>
    <section className="rail-card day-summary"><h2>{props.selectedDate.slice(5).replace("-", "月")}日概览</h2>
      <dl><div><dt>访问量</dt><dd>{props.visitCount}</dd></div><div><dt>独立域名</dt><dd>{props.ranking.length}</dd></div><div><dt>会话</dt><dd>{props.sessions.length}</dd></div>
        <div><dt>观察跨度</dt><dd>{formatSpan(props.sessions.reduce((sum, session) => sum + session.span, 0))}</dd></div></dl></section>
    <section className="rail-card top-domains"><header><strong>热门域名</strong><span>Top 8</span></header>
      {props.ranking.slice(0, 8).map((item, index) => <div key={item.domain}><span><i>{index + 1}</i>{item.domain}</span><b>{item.count}</b></div>)}
    </section>
  </aside>;
}

function CalendarPanel({ selectedDate, month, setMonth, visits, chooseDate }: {
  selectedDate: string; month: string; setMonth: (month: string) => void; visits: ArchivedVisit[]; chooseDate: (date: string) => void;
}) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7;
  const counts = new Map<string, number>();
  visits.forEach((visit) => counts.set(localDate(visit.visitTime), (counts.get(localDate(visit.visitTime)) || 0) + 1));
  const max = Math.max(1, ...counts.values());
  function moveMonth(offset: number) {
    const date = new Date(year, monthNumber - 1 + offset, 1);
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return <section className="calendar-panel">
    <header><button onClick={() => moveMonth(-1)}><CaretLeft size={15} /></button><strong>{year}年{monthNumber}月</strong><button onClick={() => moveMonth(1)}><CaretRight size={15} /></button></header>
    <div className="weekday-row">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">
      {Array.from({ length: startOffset }, (_, index) => <i key={`blank-${index}`} />)}
      {Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const count = counts.get(date) || 0;
        return <button key={date} data-active={date === selectedDate} data-today={date === TODAY} onClick={() => chooseDate(date)}
          style={{ "--density": count ? 0.18 + (count / max) * 0.82 : 0 } as React.CSSProperties} title={`${date} · ${count} 次`}>
          {day}
        </button>;
      })}
    </div>
    <footer><span>少</span>{[.15, .3, .5, .7, 1].map((value) => <i key={value} style={{ "--density": value } as React.CSSProperties} />)}<span>多</span></footer>
  </section>;
}

function LoadingTimeline() {
  return <div className="loading-timeline">{Array.from({ length: 4 }, (_, index) => <div key={index}><i /><span /></div>)}</div>;
}

function EmptyArchive({ searchMode }: { searchMode: boolean }) {
  return <div className="empty-archive"><Archive size={36} /><h2>{searchMode ? "没有找到匹配记录" : "这一天还没有归档"}</h2>
    <p>{searchMode ? "换个关键词，或导入更早的 Webtrail 归档。" : "首次导入会在后台继续运行，之后的新访问会自动永久保存。"}</p></div>;
}
