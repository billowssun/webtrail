const DB_NAME = "webtrail-archive";
const DB_VERSION = 1;
const VISITS_STORE = "visits";
const META_STORE = "meta";
const DAY = 24 * 60 * 60 * 1000;
const BOOTSTRAP_DAYS = 3650;
const CHUNK_DAYS = 14;
const BOOTSTRAP_CHUNKS_PER_PASS = 12;

function openDb() {
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

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isWebUrl(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function visitRecord(historyItem, visit) {
  return {
    id: `chrome:${visit.id}`,
    chromeVisitId: visit.id,
    url: historyItem.url,
    title: historyItem.title || domainFromUrl(historyItem.url),
    domain: domainFromUrl(historyItem.url),
    visitTime: Number(visit.visitTime || historyItem.lastVisitTime || Date.now()),
    transition: visit.transition || "link",
    referringVisitId: visit.referringVisitId || "0",
    archivedAt: Date.now(),
    source: "chrome",
    nativePresent: true
  };
}

async function putVisits(records) {
  if (!records.length) return;
  const db = await openDb();
  const transaction = db.transaction(VISITS_STORE, "readwrite");
  const store = transaction.objectStore(VISITS_STORE);
  records.forEach((record) => store.put(record));
  await transactionDone(transaction);
  db.close();
}

async function setMeta(key, value) {
  const db = await openDb();
  const transaction = db.transaction(META_STORE, "readwrite");
  transaction.objectStore(META_STORE).put({ key, value, updatedAt: Date.now() });
  await transactionDone(transaction);
  db.close();
}

async function getMeta(key) {
  const db = await openDb();
  const transaction = db.transaction(META_STORE, "readonly");
  const result = await requestResult(transaction.objectStore(META_STORE).get(key));
  db.close();
  return result?.value;
}

async function archiveHistoryItem(historyItem, startTime = 0, endTime = Date.now()) {
  if (!isWebUrl(historyItem.url)) return 0;
  const visits = await chrome.history.getVisits({ url: historyItem.url });
  const records = visits
    .filter((visit) => Number(visit.visitTime) >= startTime && Number(visit.visitTime) < endTime)
    .map((visit) => visitRecord(historyItem, visit));
  await putVisits(records);
  return records.length;
}

async function processInBatches(items, startTime, endTime) {
  let archived = 0;
  for (let index = 0; index < items.length; index += 20) {
    const batch = items.slice(index, index + 20);
    const counts = await Promise.all(batch.map((item) =>
      archiveHistoryItem(item, startTime, endTime).catch(() => 0)
    ));
    archived += counts.reduce((sum, count) => sum + count, 0);
  }
  return archived;
}

async function syncWindow(startTime, endTime) {
  const items = await chrome.history.search({
    text: "",
    startTime,
    endTime,
    maxResults: 10000
  });
  return {
    urlCount: items.length,
    visitCount: await processInBatches(items, startTime, endTime)
  };
}

async function updatePublicStatus(patch) {
  const current = (await chrome.storage.local.get("archiveStatus")).archiveStatus || {};
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ archiveStatus: next });
  chrome.runtime.sendMessage({ type: "ARCHIVE_STATUS_CHANGED", status: next }).catch(() => {});
  return next;
}

async function bootstrapChunk() {
  const lowerBound = Date.now() - BOOTSTRAP_DAYS * DAY;
  const storedCursor = await getMeta("bootstrapCursor");
  const endTime = Number(storedCursor || Date.now());
  if (endTime <= lowerBound) {
    await setMeta("bootstrapComplete", true);
    await chrome.alarms.clear("webtrail-bootstrap");
    await updatePublicStatus({ phase: "ready", bootstrapComplete: true, lastSyncAt: Date.now() });
    return true;
  }
  const startTime = Math.max(lowerBound, endTime - CHUNK_DAYS * DAY);
  await updatePublicStatus({ phase: "importing", bootstrapComplete: false, importStart: lowerBound, importCursor: endTime });
  const result = await syncWindow(startTime, endTime);
  await setMeta("bootstrapCursor", startTime);
  await updatePublicStatus({
    phase: "importing",
    importedUrls: result.urlCount,
    importedVisits: result.visitCount,
    importCursor: startTime
  });
  return false;
}

async function bootstrapPass() {
  const startedAt = Date.now();
  for (let index = 0; index < BOOTSTRAP_CHUNKS_PER_PASS; index += 1) {
    const complete = await bootstrapChunk();
    if (complete || Date.now() - startedAt > 20_000) return;
  }
}

async function syncRecent() {
  const endTime = Date.now() + 1000;
  const startTime = endTime - 3 * DAY;
  const result = await syncWindow(startTime, endTime);
  const bootstrapComplete = Boolean(await getMeta("bootstrapComplete"));
  await updatePublicStatus({
    phase: bootstrapComplete ? "ready" : "importing",
    bootstrapComplete,
    lastSyncAt: Date.now(),
    recentUrls: result.urlCount,
    recentVisits: result.visitCount
  });
}

async function markNativeRemoved(removed) {
  const db = await openDb();
  const transaction = db.transaction(VISITS_STORE, "readwrite");
  const store = transaction.objectStore(VISITS_STORE);
  const request = store.openCursor();
  await new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const record = cursor.value;
      if (removed.allHistory || removed.urls?.includes(record.url)) {
        cursor.update({ ...record, nativePresent: false, nativeRemovedAt: Date.now() });
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  await transactionDone(transaction);
  db.close();
  chrome.runtime.sendMessage({ type: "ARCHIVE_CHANGED" }).catch(() => {});
}

async function ensureAlarms() {
  await chrome.alarms.create("webtrail-bootstrap", { delayInMinutes: 0.1, periodInMinutes: 1 });
  await chrome.alarms.create("webtrail-recent-sync", { delayInMinutes: 1, periodInMinutes: 30 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms().catch(() => {});
  bootstrapPass().catch((error) => updatePublicStatus({ phase: "error", error: error.message }));
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms().catch(() => {});
  syncRecent().catch((error) => updatePublicStatus({ phase: "error", error: error.message }));
  bootstrapPass().catch((error) => updatePublicStatus({ phase: "error", error: error.message }));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "webtrail-bootstrap") {
    bootstrapPass().catch((error) => updatePublicStatus({ phase: "error", error: error.message }));
  }
  if (alarm.name === "webtrail-recent-sync") {
    syncRecent().catch((error) => updatePublicStatus({ phase: "error", error: error.message }));
  }
});

chrome.history.onVisited.addListener((historyItem) => {
  archiveHistoryItem(historyItem, 0, Date.now() + 1000)
    .then(() => chrome.runtime.sendMessage({ type: "ARCHIVE_CHANGED" }).catch(() => {}))
    .catch(() => {});
});

chrome.history.onVisitRemoved.addListener((removed) => {
  markNativeRemoved(removed).catch(() => {});
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SYNC_NOW") {
    syncRecent().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "DELETE_NATIVE") {
    Promise.all((message.urls || []).map((url) => chrome.history.deleteUrl({ url })))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "OPEN_URLS") {
    Promise.all((message.urls || []).slice(0, 30).map((url) => chrome.tabs.create({ url, active: false })))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
