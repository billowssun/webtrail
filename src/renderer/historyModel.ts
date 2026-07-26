import type { ArchivedVisit } from "./archiveDb";

export type VisitSession = {
  id: string;
  start: number;
  end: number;
  span: number;
  visits: ArchivedVisit[];
  domains: string[];
  title: string;
};

const SESSION_GAP = 30 * 60 * 1000;

function sessionTitle(visits: ArchivedVisit[]) {
  const counts = new Map<string, number>();
  visits.forEach((visit) => counts.set(visit.domain, (counts.get(visit.domain) || 0) + 1));
  const domains = Array.from(counts).sort((a, b) => b[1] - a[1]).map(([domain]) => domain);
  if (domains.some((domain) => domain.includes("developer.chrome.com")) && domains.some((domain) => domain.includes("github.com"))) {
    return "扩展开发与实现";
  }
  if (domains.some((domain) => domain.includes("figma.com"))) return "产品设计与界面";
  if (domains.some((domain) => domain.includes("notion.so")) || domains.some((domain) => domain.includes("linear.app"))) {
    return "规划与资料整理";
  }
  if (domains.some((domain) => domain.includes("youtube.com"))) return "视频与内容浏览";
  return domains.slice(0, 2).join(" · ") || "浏览会话";
}

export function buildSessions(visitsNewestFirst: ArchivedVisit[]) {
  const ascending = visitsNewestFirst.slice().sort((a, b) => a.visitTime - b.visitTime);
  const sessions: VisitSession[] = [];
  let current: ArchivedVisit[] = [];
  ascending.forEach((visit) => {
    const previous = current.at(-1);
    if (previous && visit.visitTime - previous.visitTime > SESSION_GAP) {
      sessions.push(toSession(current));
      current = [];
    }
    current.push(visit);
  });
  if (current.length) sessions.push(toSession(current));
  return sessions.reverse();
}

function toSession(visits: ArchivedVisit[]): VisitSession {
  const first = visits[0];
  const last = visits.at(-1)!;
  return {
    id: `session:${first.id}`,
    start: first.visitTime,
    end: last.visitTime,
    span: Math.max(0, last.visitTime - first.visitTime),
    visits,
    domains: Array.from(new Set(visits.map((visit) => visit.domain))),
    title: sessionTitle(visits)
  };
}

export function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

export function formatDate(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatSpan(ms: number) {
  if (ms < 60 * 1000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export function domainRanking(visits: ArchivedVisit[]) {
  const map = new Map<string, number>();
  visits.forEach((visit) => map.set(visit.domain, (map.get(visit.domain) || 0) + 1));
  return Array.from(map, ([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);
}

export function hourlyCounts(visits: ArchivedVisit[]) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  visits.forEach((visit) => { buckets[new Date(visit.visitTime).getHours()].count += 1; });
  return buckets;
}
