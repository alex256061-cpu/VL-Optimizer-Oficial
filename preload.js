// preload.js — ponte segura renderer <-> main (lista branca de canais)
const { contextBridge, ipcRenderer, shell } = require('electron');

const SEND = ['minimize-window', 'maximize-window', 'close-window', 'logout', 'open-scaling-window', 'gs-minimize', 'gs-maximize', 'gs-close'];
const INVOKE = [
  'get-user', 'check-session', 'login', 'register', 'open-site', 'update-status', 'update-install', 'claim-key',
  'telemetry-consent', 'telemetry-consent-set', 'offers', 'plan-event', 'autostart-get', 'autostart-set',
  'get-hardware', 'get-stats', 'get-mem-stats', 'get-processes', 'kill-process',
  'run-action', 'revert-action', 'restore-all', 'get-backups', 'get-caps', 'run-check',
  'measure-bottleneck', 'bn-find-game', 'bn-notify',
  'games-scan', 'games-status', 'set-auto-mode', 'game-clean', 'shader-clean',
  'ram-clean', 'ram-status', 'ram-auto-set',
  'startup-list', 'startup-set', 'get-recommendations',
  'clean-scan', 'clean-run', 'disk-drives', 'disk-scan', 'disk-scan-status', 'disk-scan-cancel', 'disk-open',
  'apps-list', 'apps-extra', 'apps-uninstall', 'apps-exists', 'apps-leftovers', 'apps-remove-leftovers',
  'tweaks-status', 'tweak-set', 'tweak-dns', 'tweak-tool', 'actions-status',
  'fps-status', 'fps-set-target', 'fps-record', 'fps-clear', 'fps-overlay-set', 'fps-base-mark', 'fps-base-clear',
  'opti-status', 'opti-download', 'opti-browse', 'opti-analyze', 'opti-detect', 'opti-install', 'opti-uninstall', 'opti-config', 'opti-open-folder',
  'fivem-gfx-status', 'fivem-gfx-apply', 'fivem-gfx-restore', 'open-gpu-panel',
  'pcinfo-get', 'pcinfo-live',
  'ls-browse-exe', 'ls-find-exe', 'ls-launch', 'ls-stop', 'ls-config', 'ls-status',
  'gdz-scaling-get-res', 'gdz-scaling-apply', 'gdz-scaling-revert',
  'gdz-scaling-caps', 'gdz-scaling-status', 'gdz-scaling-artifacts',
  'admin-status', 'elevate-now',
];
const ON = ['fps-update', 'overlay-update', 'entitlement-update', 'update-status', 'fps-hotkey'];

contextBridge.exposeInMainWorld('electron', {
  send(channel, ...args) {
    if (SEND.includes(channel)) ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    if (INVOKE.includes(channel)) return ipcRenderer.invoke(channel, ...args);
    return Promise.reject(new Error('Canal não permitido: ' + channel));
  },
  on(channel, cb) {
    if (!ON.includes(channel) || typeof cb !== 'function') return;
    ipcRenderer.on(channel, (e, ...a) => cb(...a));
  },
  openExternal(url) {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  },
});
