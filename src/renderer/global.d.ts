import type { DashboardApi } from "./types";

declare global {
  interface Window {
    dashboardApi: DashboardApi;
  }
}

export {};
