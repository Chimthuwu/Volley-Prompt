const { contextBridge, ipcRenderer } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('pv', {
  // Legacy (backward compatibility)
  hasKey: inv('key:has'), saveKey: inv('key:save'), testKey: inv('key:test'),
  models: inv('models:list'), copy: inv('clipboard:write'), openFolder: inv('folder:open'), openUrl: inv('url:open'),
  start: inv('run:start'), sendNotes: inv('run:notes'), stop: inv('run:stop'),
  winMin: inv('window:minimize'), winMax: inv('window:maximize'), winClose: inv('window:close'),
  runs: inv('runs:list'),
  onEvent: (cb) => ipcRenderer.on('run:event', (_e, ev) => cb(ev)),

  // Provider management
  providersList: inv('providers:list'),
  providersStatus: inv('providers:status'),
  providerConnect: inv('provider:connect'),
  providerDisconnect: inv('provider:disconnect'),
  providerSaveCreds: inv('provider:saveCreds'),
  providerLoadCreds: inv('provider:loadCreds'),
  providerModels: inv('provider:models'),
  providerTestKey: inv('provider:testKey'),
});