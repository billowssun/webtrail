const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dashboardApi", {
  getStore: () => ipcRenderer.invoke("store:get"),
  scanBrowserHistory: (date) => ipcRenderer.invoke("source:scan-browser-history", date),
  getMonth: (payload) => ipcRenderer.invoke("calendar:get-month", payload),
  getDay: (date) => ipcRenderer.invoke("digest:get-day", date)
});
