// No Discord or Qwen network traffic: HTTPS is served by this local fixture.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const profile = path.resolve(root, 'cache', `smoke-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setAppPath(root);
app.disableHardwareAcceleration();
let apiCalls = 0;
let streamCalls = 0;
let providerDelay = 15;
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#313338;color:white;font:16px Arial;margin:30px}main{max-width:900px}form{margin-top:30px}#editor{min-height:60px;background:#202225;padding:15px}</style></head><body><main><h1>本地 Discord 翻译适配测试</h1><ol><li id="chat-messages-123-1001"><div id="message-content-1001">Hello</div></li></ol><form><div id="editor" role="textbox" contenteditable="true" data-slate-editor="true"></div></form></main><script>window.sent=[];document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.sent.push(document.getElementById('editor').innerText);document.getElementById('editor').textContent='';}});</script></body></html>`;
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
async function until(check, label) {
  // Bounded polling must observe the result before the next attempt.
  // oxlint-disable-next-line no-await-in-loop
  for (let index = 0; index < 80; index++) { if (await check()) return; await wait(50); }
  throw new Error(`Timeout: ${label}`);
}
async function main() {
  await app.whenReady();
  session.defaultSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.hostname === 'discord.com') return new Response(fixture, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.hostname.startsWith('dashscope')) {
      apiCalls++;
      const body = JSON.parse(await request.text());
      await wait(providerDelay);
      const content = body.messages[0].content.includes('（zh）') ? '你好' : 'Hello';
      if (body.stream) {
        streamCalls++;
        return new Response(new ReadableStream({ async start(controller) {
          const encoder = new TextEncoder();
          for (const char of content) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: char }, finish_reason: null }] })}\n\n`));
            // Deliberately deliver successive stream chunks over time.
            // oxlint-disable-next-line no-await-in-loop
            await wait(20);
          }
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Blocked in local test', { status: 403 });
  });
  const { TranslationStore } = require('../app/code/main/translation/store.js');
  const { defaultTranslationSettings } = require('../app/code/common/translation.js');
  const { attachTranslation } = require('../app/code/main/translation/ipc.js');
  const store = new TranslationStore();
  store.save({ ...defaultTranslationSettings, consent: true }, 'fixture-key-not-a-real-secret');
  assert(!fs.readFileSync(path.resolve(profile, 'translation.json'), 'utf8').includes('fixture-key-not-a-real-secret'));
  const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { preload: path.resolve(__dirname, 'electron-preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  attachTranslation(win);
  await win.loadURL('https://discord.com/channels/@me/123');
  await until(() => win.webContents.executeJavaScript(`document.querySelector('[data-xikii-translation]')?.textContent==='你好'`), 'incoming translation');
  const enter = async text => {
    await win.webContents.executeJavaScript(`document.getElementById('editor').textContent=${JSON.stringify(text)};document.getElementById('editor').focus();`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  };
  await enter('你好');
  await until(() => apiCalls >= 2, 'outgoing preview request');
  await wait(100);
  assert.deepEqual(await win.webContents.executeJavaScript('window.sent'), [], 'preview must not send');
  assert.equal(await win.webContents.executeJavaScript(`document.getElementById('editor').innerText`), '你好');
  fs.mkdirSync(path.resolve(root, 'cache/evidence'), { recursive: true });
  win.webContents.invalidate();
  await wait(250);
  fs.writeFileSync(path.resolve(root, 'cache/evidence/translation-preview.png'), (await win.webContents.capturePage()).toPNG());
  // A trusted settings window uses the same production IPC controls.
  const settings = new BrowserWindow({ show: false, width: 1150, height: 1000, webPreferences: { preload: path.resolve(__dirname, 'electron-settings-preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  attachTranslation(settings, true);
  await settings.loadFile(path.resolve(root, 'sources/assets/web/html/settings.html'));
  await until(() => settings.webContents.executeJavaScript(`!!document.querySelector('.xikii-settings-form button')`), 'settings form');
  assert.deepEqual(await settings.webContents.executeJavaScript(`Array.from(document.querySelector('.xikii-settings-form select').options, option => option.value)`), ['en', 'zh']);
  assert.deepEqual(await settings.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tabpanel]'), panel => panel.hidden)`), [false, true]);
  await settings.webContents.executeJavaScript(`document.getElementById('settings-tab-client').click();`);
  assert.deepEqual(await settings.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tabpanel]'), panel => panel.hidden)`), [true, false]);
  await settings.webContents.executeJavaScript(`document.getElementById('settings-tab-translation').click();`);
  settings.webContents.invalidate();
  await wait(250);
  fs.writeFileSync(path.resolve(root, 'cache/evidence/translation-settings.png'), (await settings.webContents.capturePage()).toPNG());
  // Drive a real, trusted submit through Chromium input (no synthetic click bypass).
  const save = await settings.webContents.executeJavaScript(`(()=>{const boxes=document.querySelectorAll('input[type=checkbox]');boxes[2].checked=true;boxes[3].checked=false;boxes[4].checked=true;const button=document.querySelector('button[type=submit]');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  settings.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...save });
  settings.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...save });
  await until(() => settings.webContents.executeJavaScript(`document.querySelector('[role=status]').textContent.includes('已保存')`), 'save settings');
  await until(() => win.webContents.executeJavaScript(`document.getElementById('message-content-1001').style.display==='none' && document.querySelector('[data-xikii-translation]')?.textContent==='你好'`), 'streaming translation hides original only after completion');
  await win.webContents.executeJavaScript(`const nav=document.createElement('nav');nav.innerHTML='<a href="/channels/@me/123">Test DM</a><a href="/channels/789/777">Test channel</a>';document.body.prepend(nav);`);
  await until(() => win.webContents.executeJavaScript(`document.querySelectorAll('[data-xikii-translation-badge]').length===1`), 'enabled DM sidebar badge');
  await wait(250);
  await enter('你好，自动发送');
  await until(async () => (await win.webContents.executeJavaScript('window.sent')).length === 1, 'automatic send');
  assert.deepEqual(await win.webContents.executeJavaScript('window.sent'), ['Hello']);
  assert(streamCalls >= 2, 'incoming and outgoing must use streaming when enabled');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control', 'alt'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control', 'alt'] });
  await until(() => win.webContents.executeJavaScript(`document.getElementById('message-content-1001').style.display==='' && document.querySelectorAll('[data-xikii-translation]').length===0 && document.querySelectorAll('[data-xikii-translation-badge]').length===0`), 'shortcut disables translation and restores original');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control', 'alt'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control', 'alt'] });
  await until(() => win.webContents.executeJavaScript(`document.querySelector('[data-xikii-translation]')?.textContent==='你好'`), 'shortcut enables translation');
  providerDelay = 350;
  await enter('这是一条新草稿');
  await wait(100);
  await win.webContents.executeJavaScript(`document.getElementById('editor').textContent='用户已修改草稿';`);
  await wait(500);
  assert.deepEqual(await win.webContents.executeJavaScript('window.sent'), ['Hello'], 'editing during translation must not send');
  assert.equal(await win.webContents.executeJavaScript(`document.getElementById('editor').innerText`), '用户已修改草稿');
  await enter('切换会话测试');
  await wait(100);
  await win.webContents.executeJavaScript(`history.pushState({},'', '/channels/@me/456');`);
  await wait(600);
  assert.deepEqual(await win.webContents.executeJavaScript('window.sent'), ['Hello'], 'navigation during translation must not send');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[data-xikii-translation]').length`), 0, 'old channel DOM must not receive new translations');
  const output = { passed: ['encrypted-key-storage', 'incoming-render', 'preview-keeps-draft', 'settings-save', 'chinese-english-options-only', 'settings-tabs', 'streaming-incoming-and-outgoing', 'hide-original-after-success', 'enabled-sidebar-badge', 'shortcut-toggle-restores-original', 'automatic-send-once', 'edited-draft-not-sent', 'navigation-not-sent', 'conversation-isolation'], apiCalls, streamCalls, externalNetwork: false };
  fs.writeFileSync(path.resolve(root, 'cache/evidence/smoke-result.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
  settings.destroy(); win.destroy(); app.exit(0);
}
main().catch(error => { console.error(error); app.exit(1); });



