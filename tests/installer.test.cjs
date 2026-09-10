const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture(event, options = {}) {
  const calls = [], login = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/code/main/modules/installer.js'), 'utf8'), {
    exports: module.exports, module,
    process: { platform: options.platform || 'win32', argv: ['client.exe', event], execPath: options.executable || 'C:\\Client with spaces\\app-0.1.3\\xikii-discord-case.exe' },
    console: { error() {} },
    require(id) {
      if (id === 'electron/main') return { app: { setLoginItemSettings(value) { login.push(value); if(options.loginFails) throw new Error('Denied'); } } };
      if (id === 'node:child_process') return { spawnSync(...args) { calls.push(args); return options.result || { status: 0 }; } };
      if (id === 'node:path') return path.win32;
      if (id === 'node:fs') return { existsSync: () => options.exists !== false };
      throw new Error('Unexpected dependency: ' + id);
    }
  });
  return { run: module.exports.handleInstallerEvent, calls, login };
}
void test('post-install first run and ordinary launches continue without changing Windows settings', () => {
  for (const event of [undefined, '--squirrel-firstrun', '--version', '--squirrel-unknown']) {
    const f = fixture(event); assert.equal(f.run(), null); assert.equal(f.calls.length, 0); assert.equal(f.login.length, 0);
  }
  assert.equal(fixture('--squirrel-install', { platform: 'linux' }).run(), null);
});
void test('installation and update wait for the bundled updater to create shortcuts without a shell', () => {
  for (const event of ['--squirrel-install', '--squirrel-updated']) {
    const f=fixture(event); assert.equal(f.run(), 0); assert.equal(f.calls.length, 1); assert.equal(f.login.length, 0);
    const [exe,args,options]=f.calls[0];
    assert.equal(exe, 'C:\\Client with spaces\\Update.exe');
    assert.deepEqual(Array.from(args), ['--createShortcut', 'xikii-discord-case.exe']);
    assert.equal(options.windowsHide,true); assert.equal(options.timeout,10000); assert.equal(options.shell,undefined);
  }
});
void test('uninstall removes only this app startup entry and shortcuts while obsolete update leaves them alone', () => {
  const f=fixture('--squirrel-uninstall'); assert.equal(f.run(),0);
  assert.equal(f.login[0].name,'XIKII Discord Case'); assert.equal(f.login[0].path,'C:\\Client with spaces\\xikii-discord-case.exe');
  assert.equal(f.login[0].openAtLogin,false); assert.equal(f.login[0].enabled,false); assert.equal(f.login[0].args[0],'--start-minimized');
  assert.equal(f.calls[0][1][0],'--removeShortcut');
  const old=fixture('--squirrel-obsolete'); assert.equal(old.run(),0); assert.equal(old.calls.length,0); assert.equal(old.login.length,0);
});
void test('invalid installer directories and updater failures cannot be reported as success', () => {
  for(const options of [{exists:false},{executable:'C:\\Portable\\xikii-discord-case.exe'}]) {
    const f=fixture('--squirrel-install',options);assert.equal(f.run(),1);assert.equal(f.calls.length,0);
  }
  for(const result of [{status:1},{status:null,error:new Error('ETIMEDOUT')}]) assert.equal(fixture('--squirrel-install',{result}).run(),1);
  const denied=fixture('--squirrel-uninstall',{loginFails:true}); assert.equal(denied.run(),1);assert.equal(denied.calls.length,1);
});
