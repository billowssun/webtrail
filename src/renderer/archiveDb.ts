export type ArchivedVisit = {
  id: string;
  chromeVisitId?: string;
  url: string;
  title: string;
  domain: string;
  visitTime: number;
  transition: string;
  referringVisitId?: string;
  archivedAt: number;
  source: "chrome" | "import";
  nativePresent: boolean;
  nativeRemovedAt?: number;
};

export type ArchiveStatus = {
  phase?: "idle" | "importing" | "ready" | "error";
  bootstrapComplete?: boolean;
  importStart?: number;
  importCursor?: number;
  importedUrls?: number;
  importedVisits?: number;
  lastSyncAt?: number;
  error?: string;
  updatedAt?: number;
};

const DB_NAME = "webtrail-archive";
const DB_VERSION = 1;
const VISITS_STORE = "visits";
const META_STORE = "meta";

export const isExtension = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VISITS_STORE)) {
        const store = db.createObjectStore(VISITS_STORE, { keyPath: "id" });
        store.createIndex("visitTime", "visitTime");
        store.createIndex("domain", "domain");
        store.createIndex("url", "url");
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function putVisits(visits: ArchivedVisit[]) {
  if (!visits.length) return;
  const db = await openDb();
  const transaction = db.transaction(VISITS_STORE, "readwrite");
  const store = transaction.objectStore(VISITS_STORE);
  visits.forEach((visit) => store.put(visit));
  await transactionDone(transaction);
  db.close();
}

export async function deleteArchivedVisits(ids: string[]) {
  const db = await openDb();
  const transaction = db.transaction(VISITS_STORE, "readwrite");
  const store = transaction.objectStore(VISITS_STORE);
  ids.forEach((id) => store.delete(id));
  await transactionDone(transaction);
  db.close();
}

export async function queryVisits({
  startTime = 0,
  endTime = Date.now() + 1,
  text = "",
  limit = 50000
}: {
  startTime?: number;
  endTime?: number;
  text?: string;
  limit?: number;
} = {}) {
  const db = await openDb();
  const transaction = db.transaction(VISITS_STORE, "readonly");
  const index = transaction.objectStore(VISITS_STORE).index("visitTime");
  const range = IDBKeyRange.bound(startTime, endTime, false, true);
  const query = text.trim().toLowerCase();
  const visits: ArchivedVisit[] = [];
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(range, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || visits.length >= limit) return resolve();
      const visit = cursor.value as ArchivedVisit;
      const haystack = `${visit.title} ${visit.url} ${visit.domain} ${visit.transition}`.toLowerCase();
      if (!query || haystack.includes(query)) visits.push(visit);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  db.close();
  return visits;
}

export async function getArchiveStats() {
  const db = await openDb();
  const transaction = db.transaction(VISITS_STORE, "readonly");
  const store = transaction.objectStore(VISITS_STORE);
  const countRequest = store.count();
  const oldestRequest = store.index("visitTime").openCursor(undefined, "next");
  const newestRequest = store.index("visitTime").openCursor(undefined, "prev");
  const [count, oldest, newest] = await Promise.all([
    new Promise<number>((resolve, reject) => {
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    }),
    new Promise<number | null>((resolve, reject) => {
      oldestRequest.onsuccess = () => resolve(oldestRequest.result?.value?.visitTime ?? null);
      oldestRequest.onerror = () => reject(oldestRequest.error);
    }),
    new Promise<number | null>((resolve, reject) => {
      newestRequest.onsuccess = () => resolve(newestRequest.result?.value?.visitTime ?? null);
      newestRequest.onerror = () => reject(newestRequest.error);
    })
  ]);
  db.close();
  const estimate = await navigator.storage?.estimate?.();
  return {
    count,
    oldest,
    newest,
    usage: estimate?.usage || 0,
    quota: estimate?.quota || 0
  };
}

export async function getArchiveStatus(): Promise<ArchiveStatus> {
  if (!isExtension) return { phase: "ready", bootstrapComplete: true, lastSyncAt: Date.now() };
  const result = await chrome.storage.local.get("archiveStatus");
  return result.archiveStatus || { phase: "idle", bootstrapComplete: false };
}

export async function sendExtensionMessage<T = { ok: boolean; error?: string }>(message: unknown): Promise<T> {
  if (!isExtension) return { ok: true } as T;
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

export function faviconUrl(url: string) {
  if (!isExtension) return "";
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
}

export function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportArchiveJson() {
  const visits = await queryVisits({ startTime: 0, endTime: Date.now() + 1, limit: 500000 });
  downloadBlob(JSON.stringify({
    format: "webtrail-archive-v1",
    exportedAt: new Date().toISOString(),
    visits
  }, null, 2), `webtrail-archive-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export async function importArchiveFile(file: File) {
  const text = await file.text();
  let visits: ArchivedVisit[] = [];
  if (file.name.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text);
    const input = Array.isArray(parsed) ? parsed : parsed.visits;
    if (!Array.isArray(input)) throw new Error("JSON 中没有 visits 数组");
    visits = input.map((item: Partial<ArchivedVisit>, index: number) => {
      const visitTime = Number(item.visitTime || Date.now());
      const url = String(item.url || "");
      return {
        id: String(item.id || `import:${visitTime}:${index}`),
        url,
        title: String(item.title || domainFromUrl(url) || "导入记录"),
        domain: String(item.domain || domainFromUrl(url)),
        visitTime,
        transition: String(item.transition || "link"),
        archivedAt: Number(item.archivedAt || Date.now()),
        source: "import" as const,
        nativePresent: Boolean(item.nativePresent)
      };
    }).filter((item: ArchivedVisit) => item.domain && Number.isFinite(item.visitTime));
  } else {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(lines.shift() || "");
    const indexOf = (name: string) => headers.indexOf(name);
    visits = lines.map((line, index) => {
      const row = parseCsvLine(line);
      const date = row[indexOf("日期")] || "";
      const time = row[indexOf("时间")] || "00:00";
      const domain = row[indexOf("网站")] || "";
      const route = row[indexOf("安全路径")] || "/";
      const title = row[indexOf("当前标题")] || domain;
      const visitTime = new Date(`${date}T${time}:00`).getTime();
      return {
        id: `import:${visitTime}:${index}`,
        url: `https://${domain}${route.startsWith("/") ? route : `/${route}`}`,
        title,
        domain,
        visitTime,
        transition: row[indexOf("导航类型")] || "link",
        archivedAt: Date.now(),
        source: "import" as const,
        nativePresent: false
      };
    }).filter((item) => item.domain && Number.isFinite(item.visitTime));
  }
  await putVisits(visits);
  return visits.length;
}

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export async function ensureDemoArchive() {
  if (isExtension) return;
  const stats = await getArchiveStats();
  if (stats.count) return;
  const domains = [
    ["github.com", "Webtrail · GitHub", "/webtrail/app"],
    ["developer.chrome.com", "Chrome 扩展开发文档", "/docs/extensions"],
    ["developer.mozilla.org", "IndexedDB API · MDN", "/zh-CN/docs/Web/API/IndexedDB_API"],
    ["figma.com", "Webtrail 产品界面", "/design/webtrail"],
    ["notion.so", "历史产品竞品研究", "/workspace/history"],
    ["youtube.com", "浏览器历史管理方案对比", "/watch/demo"],
    ["react.dev", "React 参考文档", "/reference/react"],
    ["betterhistory.io", "BetterHistory 功能说明", "/features"],
    ["web.dev", "Origin private file system", "/origin-private-file-system"],
    ["linear.app", "Webtrail 扩展迁移计划", "/team/webtrail"]
  ];
  const anchor = new Date();
  anchor.setHours(23, 30, 0, 0);
  const visits: ArchivedVisit[] = [];
  for (let dayOffset = 0; dayOffset < 120; dayOffset += 1) {
    const count = dayOffset < 7 ? 34 + Math.floor(seededRandom(dayOffset) * 30) : 4 + Math.floor(seededRandom(dayOffset) * 18);
    for (let index = 0; index < count; index += 1) {
      const site = domains[Math.floor(seededRandom(dayOffset * 100 + index) * domains.length)];
      const hour = 8 + Math.floor(seededRandom(dayOffset * 137 + index * 11) * 14);
      const minute = Math.floor(seededRandom(dayOffset * 41 + index * 17) * 60);
      const date = new Date(anchor);
      date.setDate(date.getDate() - dayOffset);
      date.setHours(hour, minute, 0, 0);
      visits.push({
        id: `demo:${dayOffset}:${index}`,
        url: `https://${site[0]}${site[2]}/${index}`,
        title: index % 4 ? site[1] : `${site[1]} — 实践与方案`,
        domain: site[0],
        visitTime: date.getTime(),
        transition: index % 9 === 0 ? "typed" : index % 7 === 0 ? "reload" : "link",
        archivedAt: Date.now(),
        source: "chrome",
        nativePresent: dayOffset < 90
      });
    }
  }
  await putVisits(visits);
}
