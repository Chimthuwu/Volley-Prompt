const { contextBridge, ipcRenderer } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('pv', {
  hasKey: inv('key:has'), keyState: inv('key:state'), saveKey: inv('key:save'), testKey: inv('key:test'),
  models: inv('models:list'), copy: inv('clipboard:write'), openFolder: inv('folder:open'), openUrl: inv('url:open'),
  start: inv('run:start'), sendNotes: inv('run:notes'), stop: inv('run:stop'), setRunModels: inv('run:models'),
  winMin: inv('window:minimize'), winMax: inv('window:maximize'), winClose: inv('window:close'),
  runs: inv('runs:list'), openRun: inv('runs:read'), updateRun: inv('runs:update'), utility: inv('utility:call'), keyUsage: inv('key:usage'),
  githubTokenInfo: inv('github:token:has'), saveGithubToken: inv('github:token:set'), clearGithubToken: inv('github:token:clear'), fetchGithubRepo: inv('github:repo:fetch'),
  onEvent: (cb) => ipcRenderer.on('run:event', (_e, ev) => cb(ev)),
});
