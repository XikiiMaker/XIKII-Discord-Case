// Two Electron invocations share ONLY this synthetic test profile. No real login is read.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const phase = process.argv.at(-1);
const profile = path.resolve(root, 'cache/session-persistence-fixture');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile); app.setAppPath(root); app.disableHardwareAcceleration();
async function main() {
  await app.whenReady();
  const { installSessionPersistence } = require('../app/code/main/modules/desktop.js');
  installSessionPersistence();
  session.defaultSession.protocol.handle('https', () => new Response('<html><body>Session persistence test</body></html>', { headers: { 'Content-Type':'text/html' } }));
  const win = new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  await win.loadURL('https://session-fixture.invalid');
  if (phase === 'write') {
    await session.defaultSession.cookies.set({url:'https://session-fixture.invalid',name:'synthetic-session',value:'fixture-only',expirationDate:Date.now()/1000+3600,secure:true,httpOnly:true});
    await win.webContents.executeJavaScript("localStorage.setItem('synthetic-login', 'fixture-only')");
  } else {
    assert.equal((await session.defaultSession.cookies.get({url:'https://session-fixture.invalid',name:'synthetic-session'}))[0]?.value, 'fixture-only');
    assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('synthetic-login')"), 'fixture-only');
    fs.writeFileSync(path.join(root,'cache/evidence/session-persistence.json'),JSON.stringify({passed:['cookie-survives-quit-and-restart','local-storage-survives-quit-and-restart'],externalNetwork:false,realCredentialsRead:false},null,2));
  }
  console.log(`Session persistence ${phase}: passed`); app.quit();
}
main().catch(error => { console.error(error); app.exit(1); });
