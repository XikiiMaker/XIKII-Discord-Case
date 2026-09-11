const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  const app = Object.assign(new EventEmitter(), { isPackaged: true, getPath: () => 'C:\\Profile', quitCalls: 0 });
  let login = false;
  const writes = [], shortcuts = [];
  app.getLoginItemSettings = options => ({ openAtLogin: login, launchItems: login ? [{ name: 'XIKII Discord Case', enabled: true, ...options }] : [] });
  app.setLoginItemSettings = options => { writes.push(options); login = options.openAtLogin; };
  app.quit = () => { app.quitCalls++; };
  const config = { value: { settings: { privacy: { permissions: { notifications: null } }, general: { taskbar: { flash: true } } } } };
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options=options; Notification.last=this; }
    show() { this.emit('show'); }
  }
  const session = { defaultSession: { storagePath: 'persistent-fixture', flushStorageData() { session.flushed = true; }, cookies: { async flushStore() { session.cookiesFlushed = true; } } } };
  const module = { exports: {} };
  const shortcutLink = { current: null };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/code/main/modules/desktop.js'), 'utf8'), {
    exports: module.exports, module, process: { platform: 'win32', execPath: 'C:\\Client\\app-0.1.1\\client.exe' }, console, setTimeout, clearTimeout,
    require(id) {
      if (id === 'electron/main') return { app, session, Notification };
      if (id === 'electron/common') return { shell: {
        writeShortcutLink(...args) { shortcuts.push(args); shortcutLink.current = { ...args[2] }; return true; },
        readShortcutLink() { if (shortcutLink.current === null) throw new Error('not a shortcut'); return shortcutLink.current; }
      } };
      if (id === 'node:fs') return { existsSync: () => true, mkdirSync() {} };
      if (id === 'node:path') return path.win32;
      if (id === './config') return { appConfig: config };
      if (id === '../../common/modules/client') return { getBuildInfo: () => ({ AppUserModelId: 'XikiiMaker.DiscordCase' }) };
      throw new Error(`Unexpected dependency: ${id}`);
    }
  });
  return { api: module.exports, app, session, config, writes, shortcuts, shortcutLink, Notification };
}
void test('startup uses stable Squirrel launcher, matching read options, and can be disabled', () => {
  const f = fixture();
  assert.equal(f.api.launcherPath(), 'C:\\Client\\client.exe');
  assert.equal(f.api.launcherPath('C:\\Portable\\client.exe'), 'C:\\Portable\\client.exe');
  assert.equal(f.api.launcherPath('C:\\Client\\app-0.1.1\\client.exe', () => false), 'C:\\Client\\app-0.1.1\\client.exe');
  assert.equal(f.api.desktopState().openAtLogin, false);
  assert.equal(f.api.saveDesktop({ openAtLogin: true, notifications: true, flash: false }).openAtLogin, true);
  assert.equal(f.writes[0].path, 'C:\\Client\\client.exe');
  assert.equal(f.writes[0].args.join(' '), '--start-minimized');
  assert.equal(f.writes[0].name, 'XIKII Discord Case');
  assert.equal(f.config.value.settings.privacy.permissions.notifications, true);
  assert.equal(f.api.saveDesktop({ openAtLogin: false, notifications: null, flash: true }).openAtLogin, false);
  assert.equal(f.writes[1].enabled, false);
  assert.throws(() => f.api.saveDesktop({ openAtLogin: 'true', notifications: true, flash: true }));
});
void test('start menu shortcut is only rewritten when it stops matching the launcher', () => {
  const f = fixture();
  f.api.ensureNotificationShortcut();
  assert.equal(f.shortcuts.length, 1);
  assert.equal(f.shortcuts[0][2].target, 'C:\\Client\\client.exe');
  f.api.ensureNotificationShortcut();
  f.api.ensureNotificationShortcut();
  assert.equal(f.shortcuts.length, 1, 'repeated launches must not rewrite the shortcut');
  f.shortcutLink.current.target = 'C:\\Stale\\client.exe';
  f.api.ensureNotificationShortcut();
  assert.equal(f.shortcuts.length, 2, 'a stale target must be corrected');
  assert.equal(f.shortcuts[1][2].target, 'C:\\Client\\client.exe');
});
void test('development startup refuses registration and failed OS persistence is reported', () => {
  const f = fixture(); f.app.isPackaged = false;
  assert.equal(f.api.desktopState().startupSupported, false);
  assert.throws(() => f.api.saveDesktop({ openAtLogin: true, notifications: true, flash: true }));
  assert.equal(f.writes.length, 0);
  f.app.isPackaged = true; f.app.setLoginItemSettings = () => {};
  assert.throws(() => f.api.saveDesktop({ openAtLogin: true, notifications: true, flash: true }), /Windows/);
});
void test('notification identity matches shortcut and test click restores main window', async () => {
  const f = fixture(); const events = [];
  const win = { isDestroyed: () => false, restore: () => events.push('restore'), show: () => events.push('show'), focus: () => events.push('focus') };
  const result = await f.api.testDesktopNotification(win);
  assert.match(result, /系统已接收/);
  assert.equal(f.shortcuts[0][2].appUserModelId, 'XikiiMaker.DiscordCase');
  assert.equal(f.shortcuts[0][2].target, 'C:\\Client\\client.exe');
  assert.equal(f.Notification.last.options.silent, false);
  f.Notification.last.emit('click'); assert.deepEqual(events, ['restore', 'show', 'focus']);
});
void test('normal quit flushes session once before completing quit without clearing credentials', async () => {
  const f = fixture(); f.api.installSessionPersistence(); let prevented = 0;
  f.app.emit('before-quit', { preventDefault() { prevented++; } });
  f.app.emit('before-quit', { preventDefault() { prevented++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, 2); assert.equal(f.session.flushed, true); assert.equal(f.session.cookiesFlushed, true); assert.equal(f.app.quitCalls, 1);
  f.app.emit('before-quit', { preventDefault() { prevented++; } }); assert.equal(prevented, 2);
});
