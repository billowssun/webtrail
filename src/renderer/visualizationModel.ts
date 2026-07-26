import type { ArchivedVisit } from "./archiveDb";
import { buildSessions } from "./historyModel";

export const DAY = 86_400_000;

export function localDate(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dayStart(date: string) {
  return new Date(`${date}T00:00:00`).getTime();
}

export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}

export function dailySeries(visits: ArchivedVisit[], days: number, endDate: string) {
  const counts = new Map<string, number>();
  visits.forEach((visit) => {
    const key = localDate(visit.visitTime);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from({ length: days }, (_, index) => {
    const date = shiftDate(endDate, index - days + 1);
    return { date, count: counts.get(date) || 0 };
  });
}

export function weekdayHourMatrix(visits: ArchivedVisit[]) {
  const matrix = Array.from({ length: 7 * 24 }, (_, index) => [
    index % 24,
    Math.floor(index / 24),
    0
  ]);
  visits.forEach((visit) => {
    const date = new Date(visit.visitTime);
    const mondayFirst = (date.getDay() + 6) % 7;
    matrix[mondayFirst * 24 + date.getHours()][2] += 1;
  });
  return matrix;
}

export type SourceGroup = "直接访问" | "链接跳转" | "搜索与关键词" | "重新加载" | "其他";

export function sourceGroup(transition: string): SourceGroup {
  if (["typed", "auto_bookmark"].includes(transition)) return "直接访问";
  if (["link", "generated"].includes(transition)) return "链接跳转";
  if (["keyword", "keyword_generated", "form_submit"].includes(transition)) return "搜索与关键词";
  if (transition === "reload") return "重新加载";
  return "其他";
}

export function sourceMix(visits: ArchivedVisit[]) {
  const counts = new Map<SourceGroup, number>();
  visits.forEach((visit) => {
    const key = sourceGroup(visit.transition);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function observedSpan(visits: ArchivedVisit[]) {
  return buildSessions(visits).reduce((total, session) => total + session.span, 0);
}

export function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}
