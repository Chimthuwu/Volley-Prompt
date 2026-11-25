const { contextBridge, ipcRenderer } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('pv', {
  hasKey: inv('key:has'), keyState: inv('key:state'), saveKey: inv('key:save'), testKey: inv('key:test'),
  models: inv('models:list'), copy: inv('clipboard:write'), openFolder: inv('folder:open'), openUrl: inv('url:open'),
  start: inv('run:start'), sendNotes: inv('run:notes'), stop: inv('run:stop'), setRunModels: inv('run:models'),
  winMin: inv('window:minimize'), winMax: inv('window:maximize'), winClose: inv('window:close'),
  runs: inv('runs:list'), openRun: inv('runs:read'), updateRun: inv('runs:update'), utility: inv('utility:call'), keyUsage: inv('key:usage'),
  // Sidebar history management: rename / delete / move a volley, and rename / delete a project group.
  renameRun: inv('runs:rename'), deleteRun: inv('runs:delete'), moveRun: inv('runs:move'),
  projects: inv('projects:list'), renameProject: inv('projects:rename'), deleteProject: inv('projects:delete'),
  // "Send to ▸ Hermes": run the finished prompt through the local Hermes CLI.
  hermesRun: inv('hermes:run'),
  // Pairing / sync identity (todo A3): one 22-char secret shares the profile across devices.
  pairStatus: inv('pair:status'), pairGenerate: inv('pair:generate'), pairSave: inv('pair:save'), pairClear: inv('pair:clear'),
  // Sync transport (todo A4): crypto + HTTPS to the site API happen in the main process;
  // the renderer just hands over / receives the plain profile object.
  syncPull: inv('sync:pull'), syncPush: inv('sync:push'),
  // Scaffold mode (todo B2): the renderer drives the cycle loop; main.js talks to the
  // provider with the scaffold systems and (after confirm) writes the manifest to disk.
  scaffoldCall: inv('scaffold:call'), scaffoldWrite: inv('scaffold:write'), scaffoldPickDir: inv('scaffold:pickDir'),
  githubTokenInfo: inv('github:token:has'), saveGithubToken: inv('github:token:set'), clearGithubToken: inv('github:token:clear'), fetchGithubRepo: inv('github:repo:fetch'),
  // Multi-provider support
  providersList: inv('providers:list'), providersStatus: inv('providers:status'),
  providerCredsHas: inv('provider:creds:has'), providerCredsSave: inv('provider:creds:save'),
  providerModels: inv('provider:models'), providerConnect: inv('provider:connect'),
  onEvent: (cb) => ipcRenderer.on('run:event', (_e, ev) => cb(ev)),
});
