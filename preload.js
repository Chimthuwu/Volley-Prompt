const { contextBridge, ipcRenderer } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('pv', {
  hasKey: inv('key:has'), saveKey: inv('key:save'), testKey: inv('key:test'),
  models: inv('models:list'), copy: inv('clipboard:write'), openFolder: inv('folder:open'), openUrl: inv('url:open'),
  start: inv('run:start'), sendNotes: inv('run:notes'), stop: inv('run:stop'),
  onEvent: (cb) => ipcRenderer.on('run:event', (_e, ev) => cb(ev)),
});
