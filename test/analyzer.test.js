const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBrowserDashboard,
  createDayDigest,
  buildCalendarDays,
} = require("../src/analyzer");

const visits = [
  {
    id: "v1",
    title: "GitHub Pull Request Review",
    domain: "github.com",
    url: "https://github.com/example/repo/pull/1",
    visitTime: "2026-07-07T01:00:00.000Z",
    visitDuration: 120000000,
    browser: "Chrome",
    profile: "Default"
  },
  {
    id: "v2",
    title: "React docs useEffect",
    domain: "react.dev",
    url: "https://react.dev/reference/react/useEffect",
    visitTime: "2026-07-07T01:18:00.000Z",
    visitDuration: 60000000,
    browser: "Chrome",
    profile: "Default"
  },
  {
    id: "v3",
    title: "GitHub Pull Request Review",
    domain: "github.com",
    url: "https://github.com/example/repo/pull/1",
    visitTime: "2026-07-07T04:00:00.000Z",
    visitDuration: 30000000,
    browser: "Chrome",
    profile: "Default"
  },
  {
    id: "v4",
    title: "Zero Duration Page",
    domain: "example.com",
    url: "https://example.com/zero",
    visitTime: "2026-07-07T07:00:00.000Z",
    visitDuration: 0,
    browser: "Chrome",
    profile: "Default"
  }
];

test("builds site duration ranking from raw Chrome visit_duration", () => {
  const dashboard = buildBrowserDashboard({ date: "2026-07-07", browserVisits: visits });

  assert.equal(dashboard.totalDuration, 210000);
  assert.equal(dashboard.siteDurationRanking[0].domain, "github.com");
  assert.equal(dashboard.siteDurationRanking[0].duration, 150000);
  assert.equal(dashboard.siteDurationRanking[0].visitCount, 2);
});

test("builds page duration ranking with page percentage", () => {
  const dashboard = buildBrowserDashboard({ date: "2026-07-07", browserVisits: visits });
  const page = dashboard.pageDurationRanking[0];

  assert.equal(page.title, "GitHub Pull Request Review");
  assert.equal(page.duration, 150000);
  assert.equal(page.percentage, 71.4);
});

test("zero-duration visits remain visible in timeline and visit ranking", () => {
  const dashboard = buildBrowserDashboard({ date: "2026-07-07", browserVisits: visits });

  assert.equal(dashboard.zeroDurationCount, 1);
  assert.ok(dashboard.timeline.some((item) => item.title === "Zero Duration Page" && item.duration === 0));
  assert.ok(dashboard.siteVisitRanking.some((item) => item.domain === "example.com" && item.visitCount === 1));
});

test("calendar days only depend on browser visits", () => {
  const days = buildCalendarDays({
    year: 2026,
    month: 7,
    browserVisits: visits
  });
  const day = days.find((item) => item.date === "2026-07-07");

  assert.equal(day.visitCount, 4);
  assert.equal(day.signalCount, 4);
  assert.equal(Object.hasOwn(day, "hasEntry"), false);
  assert.equal(Object.hasOwn(day, "eventCount"), false);
});

test("dashboard output omits full URLs and redacts sensitive titles", () => {
  const dashboard = buildBrowserDashboard({
    date: "2026-07-07",
    browserVisits: [
      {
        id: "sensitive",
        title: "银行账户登录",
        domain: "bank.example",
        url: "https://bank.example/login?token=secret",
        visitTime: "2026-07-07T02:00:00.000Z",
        visitDuration: 45000000
      }
    ]
  });
  const serialized = JSON.stringify(dashboard);

  assert.doesNotMatch(serialized, /token=secret/);
  assert.doesNotMatch(serialized, /https:\/\/bank\.example/);
  assert.match(serialized, /敏感标题已隐藏|可能包含敏感信息/);
});

test("day digest carries the browser dashboard as primary output", () => {
  const digest = createDayDigest({ date: "2026-07-07", browserVisits: visits });

  assert.equal(digest.dashboard.visitCount, 4);
  assert.equal(digest.overview, digest.dashboard.summary);
});
