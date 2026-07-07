const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const initSqlJs = require("sql.js");
const {
  createDayDigest,
  buildCalendarDays
} = require("./analyzer");

const STORE_VERSION = 2;

let mainWindow;
let sqlPromise;

function localDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function getStorePath() {
  return path.join(app.getPath("userData"), "browser-dashboard-store.json");
}

function createEmptyStore() {
  return {
    version: STORE_VERSION,
    sources: {
      browserVisits: []
    }
  };
}

function migrateStore(store) {
  const next = createEmptyStore();
  next.sources = {
    browserVisits: store.sources?.browserVisits || store.sources?.browserHistoryItems || []
  };
  next.version = STORE_VERSION;
  return next;
}

async function readStore() {
  try {
    const raw = await fs.readFile(getStorePath(), "utf8");
    return migrateStore(JSON.parse(raw));
  } catch {
    return createEmptyStore();
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(getStorePath()), { recursive: true });
  await fs.writeFile(getStorePath(), JSON.stringify(migrateStore(store), null, 2), "utf8");
  return store;
}

function publicStore(store) {
  return JSON.parse(JSON.stringify(migrateStore(store)));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    title: "浏览行为看板",
    backgroundColor: "#f7f2ec",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => path.join(__dirname, "..", "node_modules", "sql.js", "dist", file)
    });
  }
  return sqlPromise;
}

function getCandidateHistoryPaths() {
  const local = process.env.LOCALAPPDATA || "";
  return [
    {
      browser: "Chrome",
      profile: "Default",
      historyPath: path.join(local, "Google", "Chrome", "User Data", "Default", "History")
    },
    {
      browser: "Chrome",
      profile: "Profile 1",
      historyPath: path.join(local, "Google", "Chrome", "User Data", "Profile 1", "History")
    },
    {
      browser: "Edge",
      profile: "Default",
      historyPath: path.join(local, "Microsoft", "Edge", "User Data", "Default", "History")
    },
    {
      browser: "Edge",
      profile: "Profile 1",
      historyPath: path.join(local, "Microsoft", "Edge", "User Data", "Profile 1", "History")
    }
  ];
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function chromeTimeToIso(value) {
  const epochOffsetMs = 11644473600000;
  return new Date(value / 1000 - epochOffsetMs).toISOString();
}

function dateToChromeTime(date) {
  return (date.getTime() + 11644473600000) * 1000;
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function readChromiumVisitsForDate(historyPath, date) {
  const SQL = await getSql();
  const tempPath = path.join(os.tmpdir(), `browser-dashboard-visits-${process.pid}-${Date.now()}.sqlite`);
  await fs.copyFile(historyPath, tempPath);

  try {
    const buffer = await fs.readFile(tempPath);
    const db = new SQL.Database(buffer);
    const [year, month, day] = date.split("-").map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    const statement = db.prepare(`
      SELECT
        visits.id AS visit_id,
        visits.visit_time,
        visits.visit_duration,
        visits.transition,
        urls.id AS url_id,
        urls.url,
        urls.title,
        urls.visit_count,
        urls.typed_count
      FROM visits
      JOIN urls ON visits.url = urls.id
      WHERE visits.visit_time BETWEEN $start AND $end
      ORDER BY visits.visit_time ASC
      LIMIT 2000
    `);
    statement.bind({ $start: dateToChromeTime(start), $end: dateToChromeTime(end) });

    const visits = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      visits.push({
        id: `visit-${row.visit_id}`,
        visitTime: chromeTimeToIso(row.visit_time),
        visitDuration: row.visit_duration || 0,
        transition: row.transition || 0,
        title: row.title || "",
        url: row.url || "",
        domain: domainFromUrl(row.url || ""),
        visitCount: row.visit_count || 1,
        typedCount: row.typed_count || 0
      });
    }

    statement.free();
    db.close();
    return visits;
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

function mergeVisits(existing, incoming, date) {
  const outsideDate = existing.filter((visit) => localDateString(visit.visitTime) !== date);
  const byKey = new Map();
  incoming.forEach((visit) => {
    const key = `${visit.browser}:${visit.profile}:${visit.id}`;
    byKey.set(key, visit);
  });
  return [...outsideDate, ...Array.from(byKey.values())].sort((a, b) => new Date(a.visitTime) - new Date(b.visitTime));
}

ipcMain.handle("store:get", async () => publicStore(await readStore()));

ipcMain.handle("source:scan-browser-history", async (_event, date = localDateString()) => {
  const candidates = getCandidateHistoryPaths();
  const available = [];
  for (const candidate of candidates) {
    if (await fileExists(candidate.historyPath)) {
      available.push(candidate);
    }
  }

  const allVisits = [];
  const errors = [];
  for (const candidate of available) {
    try {
      const visits = await readChromiumVisitsForDate(candidate.historyPath, date);
      allVisits.push(...visits.map((visit) => ({ ...visit, browser: candidate.browser, profile: candidate.profile })));
    } catch (error) {
      errors.push(`${candidate.browser} ${candidate.profile}: ${error.message}`);
    }
  }

  const store = await readStore();
  store.sources.browserVisits = mergeVisits(store.sources.browserVisits || [], allVisits, date);
  await writeStore(store);

  return {
    visits: allVisits,
    availableBrowsers: available.map((item) => `${item.browser} ${item.profile}`),
    errors
  };
});

ipcMain.handle("calendar:get-month", async (_event, { year, month }) => {
  const store = await readStore();
  return buildCalendarDays({
    year,
    month,
    browserVisits: store.sources.browserVisits
  });
});

ipcMain.handle("digest:get-day", async (_event, date = localDateString()) => {
  const store = await readStore();
  const digest = createDayDigest({
    date,
    browserVisits: store.sources.browserVisits
  });
  return { digest };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
