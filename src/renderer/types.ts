export type CalendarDay = {
  date: string;
  day: number;
  weekday: number;
  visitCount: number;
  signalCount: number;
};

export type RankingItem = {
  domain: string;
  title?: string;
  duration: number;
  durationText: string;
  rawDuration?: number;
  rawDurationText?: string;
  visitCount: number;
  percentage: number;
  sensitive?: boolean;
};

export type HourlyBucket = {
  hour: number;
  label: string;
  duration: number;
  durationText: string;
  visitCount: number;
};

export type TimelineItem = {
  id: string;
  time: string;
  timeLabel: string;
  domain: string;
  title: string;
  duration: number;
  durationText: string;
  rawDuration?: number;
  rawDurationText?: string;
  hasDuration: boolean;
  durationWasCapped?: boolean;
  browser?: string;
  profile?: string;
  sensitive?: boolean;
};

export type BrowserDashboard = {
  date: string;
  generatedAt: string;
  totalDuration: number;
  totalDurationText: string;
  rawTotalDuration?: number;
  rawTotalDurationText?: string;
  cappedDurationCount?: number;
  visitCount: number;
  zeroDurationCount: number;
  siteDurationRanking: RankingItem[];
  pageDurationRanking: RankingItem[];
  siteVisitRanking: RankingItem[];
  hourlyDuration: HourlyBucket[];
  timeline: TimelineItem[];
  rawVisits: TimelineItem[];
  summary: string;
};

export type DayDigest = {
  id: string;
  date: string;
  generatedAt: string;
  dashboard: BrowserDashboard;
  overview: string;
  stats: {
    visitCount: number;
    totalDuration: number;
    zeroDurationCount: number;
  };
};

export type ScanResult = {
  visits: unknown[];
  availableBrowsers: string[];
  errors: string[];
};

export type DashboardApi = {
  getStore: () => Promise<unknown>;
  scanBrowserHistory: (date: string) => Promise<ScanResult>;
  getMonth: (payload: { year: number; month: number }) => Promise<CalendarDay[]>;
  getDay: (date: string) => Promise<{ digest: DayDigest }>;
};
