const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "src", "renderer", "public", "manifest.json"), "utf8"));
const worker = fs.readFileSync(path.join(root, "src", "renderer", "public", "service-worker.js"), "utf8");
const releaseWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");

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
  assert.match(releaseWorkflow, /npm run check/);
  assert.match(releaseWorkflow, /npm run pack:extension/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.match(releaseWorkflow, /webtrail-extension\.zip/);
});
