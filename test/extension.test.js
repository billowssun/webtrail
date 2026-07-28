const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "src", "renderer", "public", "manifest.json"), "utf8"));
const worker = fs.readFileSync(path.join(root, "src", "renderer", "public", "service-worker.js"), "utf8");
const releaseWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "renderer", "App.tsx"), "utf8");

test("builds a Manifest V3 Chrome history override", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.chrome_url_overrides.history, "index.html");
  assert.equal(manifest.background.service_worker, "service-worker.js");
  assert.ok(manifest.permissions.includes("history"));
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
  assert.ok(manifest.permissions.includes("favicon"));
});

test("service worker continuously archives visits in IndexedDB", () => {
  assert.match(worker, /indexedDB\.open/);
  assert.match(worker, /chrome\.history\.onVisited\.addListener/);
  assert.match(worker, /chrome\.history\.getVisits/);
  assert.match(worker, /chrome\.alarms\.create\("webtrail-bootstrap"/);
  assert.match(worker, /BOOTSTRAP_DAYS = 3650/);
  assert.match(worker, /BOOTSTRAP_CHUNKS_PER_PASS = 12/);
  assert.match(worker, /chrome\.runtime\.onStartup\.addListener[\s\S]*ensureAlarms/);
});

test("native history deletion marks records but does not delete the archive", () => {
  assert.match(worker, /nativePresent:\s*false/);
  assert.match(worker, /nativeRemovedAt/);
  assert.doesNotMatch(worker, /onVisitRemoved[\s\S]{0,1200}\.delete\(/);
});

test("extension declares all icon assets", () => {
  for (const size of [16, 32, 48, 128]) {
    const file = path.join(root, "src", "renderer", "public", "icons", `icon-${size}.png`);
    assert.ok(fs.existsSync(file), `missing ${file}`);
    assert.ok(fs.statSync(file).size > 100);
  }
});

test("main branch commits are packaged into GitHub Releases", () => {
  assert.match(releaseWorkflow, /branches:\s*\n\s+- main/);
  assert.match(releaseWorkflow, /actions\/checkout@v5/);
  assert.match(releaseWorkflow, /actions\/setup-node@v6/);
  assert.match(releaseWorkflow, /npm run check/);
  assert.match(releaseWorkflow, /npm run pack:extension/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.match(releaseWorkflow, /webtrail-extension\.zip/);
});

test("the product exposes only analysis and history as core views", () => {
  assert.match(app, /type ViewKey = "analysis" \| "history"/);
  assert.match(app, />可视化分析</);
  assert.match(app, />历史记录</);
  assert.doesNotMatch(app, /ViewKey.*settings/);
});

test("analysis supports linked day week month visualizations", () => {
  assert.match(app, /type PeriodMode = "day" \| "week" \| "month"/);
  assert.match(app, /Array\.from\(\{ length: 24 \}/);
  assert.match(app, /index \* 60 \* 60 \* 1000/);
  assert.match(app, /start \+ 60 \* 60 \* 1000/);
  assert.match(app, /当天访问趋势/);
  assert.match(app, /按小时/);
  assert.match(app, /type: "bar"/);
  assert.match(app, /type: "heatmap"/);
  assert.match(app, /热门域名 TOP 5/);
  assert.doesNotMatch(app, /type: "pie"/);
});

test("history provides precise BetterHistory-style filters", () => {
  assert.match(app, /最近 7 天/);
  assert.match(app, /按域名/);
  assert.match(app, /访问类型/);
  assert.match(app, /buildSessions\(dayVisits\)/);
  assert.match(app, /从 Chrome 历史删除/);
});
