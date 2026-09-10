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
let fallbackCalls = 0;
const fallbackRequests = [];
let providerUnavailable = false;
let providerDelay = 15;
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--text-muted:#949ba4;--text-normal:#dbdee1;--interactive-normal:#b5bac1;--background-secondary:#2b2d31;--font-primary:system-ui}
*{box-sizing:border-box}body{background:#313338;color:#dbdee1;font:15px system-ui;margin:0;display:flex;height:100vh}aside{width:220px;flex:none;background:#2b2d31;padding:20px 12px}aside h3{font-size:15px;margin:0 8px 28px}aside a{display:flex;flex-direction:column;color:#949ba4;text-decoration:none;border-radius:5px;padding:8px;margin:4px 0}aside a:first-of-type{background:#3f4147;color:#f2f3f5}.linkTop{display:flex;align-items:center;gap:6px}.name_native{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.channel-icon{font-size:20px;color:#949ba4}main{min-width:0;flex:1;position:relative;overflow:hidden}header{height:52px;padding:14px 20px;border-bottom:1px solid #26272b;font-weight:600}ol{padding:28px 24px 220px;margin:0;list-style:none}li{margin-bottom:24px}form{position:absolute;bottom:0;left:0;right:0;padding:0 16px 16px;background:#313338}#editor{min-height:60px;background:#383a40;border-radius:8px;padding:16px;outline:none}#editor:empty:before{content:'发送测试消息';color:#87898f}
</style></head><body><aside><h3>Xikii Industry · 本地模拟</h3><a href="/channels/@me/123"><div class="linkTop"><span class="channel-icon">#</span><div class="name_native">autotrans</div></div></a><a href="/channels/789/777"><div class="linkTop"><span class="channel-icon">#</span><div class="name_native">general</div></div></a></aside><main><header># autotrans · 翻译适配测试</header><ol><li id="chat-messages-123-1001"><div id="message-content-1001">Hello</div></li></ol><form><div id="editor" role="textbox" contenteditable="true" data-slate-editor="true"></div></form></main><script>window.sent=[];document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.sent.push(document.getElementById('editor').innerText);document.getElementById('editor').textContent='';}});</script></body></html>`;
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
      if (providerUnavailable) return new Response('Fixture outage', { status: 503 });
      const body = JSON.parse(await request.text());
      await wait(providerDelay);
      const content = body.messages.at(-1).content.includes('Long paragraph fixture') ? '我支持总体成本降低。随着人工智能超采样技术不断进步，我们可能不再需要高功耗显卡，也希望大家能够继续在自己的电脑上运行游戏。这里是一条用于检查中文自动换行间距的人工测试消息。\n\n销量也受到市场变化的影响。无论文字换行还是中英文混排，中文译文都应该保持清楚、稳定的行间距，让连续阅读更加轻松。' : body.messages[0].content.includes('（zh）') ? '你好' : 'Hello';
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
    if (url.hostname === 'fallback.test') {
      fallbackCalls++;
      const body = JSON.parse(await request.text());
      fallbackRequests.push(body.q);
      assert.equal(body.api_key, 'fixture-fallback-key');
      assert.equal(request.headers.get('Authorization'), null);
      assert.deepEqual(Object.keys(body).sort(), ['api_key', 'format', 'q', 'source', 'target']);
      return new Response(JSON.stringify({ translatedText: body.q.map(() => body.target === 'zh' ? '备用你好' : 'Fallback hello') }));
    }
    return new Response('Blocked in local test', { status: 403 });
  });
  const { TranslationStore } = require('../app/code/main/translation/store.js');
  const { defaultTranslationSettings } = require('../app/code/common/translation.js');
  const { attachTranslation } = require('../app/code/main/translation/ipc.js');
  const store = new TranslationStore();
  store.save({ ...defaultTranslationSettings, consent: true, fallback: { enabled: false, endpoint: 'https://original.test/translate' } }, 'fixture-key-not-a-real-secret', 'fixture-fallback-key');
  assert(!fs.readFileSync(path.resolve(profile, 'translation.json'), 'utf8').includes('fixture-key-not-a-real-secret'));
  assert(!fs.readFileSync(path.resolve(profile, 'translation.json'), 'utf8').includes('fixture-fallback-key'));
  const reopened = new TranslationStore();
  assert.equal(reopened.fallbackKey(), 'fixture-fallback-key');
  assert.equal(reopened.key(), 'fixture-key-not-a-real-secret');
  reopened.save({ ...defaultTranslationSettings, consent: true });
  assert.equal(reopened.fallbackKey(), '', 'changing fallback destination clears its saved key');
  assert.equal(reopened.key(), 'fixture-key-not-a-real-secret', 'Qwen key is retained separately');
  const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { preload: path.resolve(__dirname, 'electron-preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  attachTranslation(win);
  await win.loadURL('https://discord.com/channels/@me/123');
  await until(() => win.webContents.executeJavaScript(`document.querySelector('[data-xikii-translation]')?.textContent==='你好'`), 'incoming translation');
  const checkLayout = async () => {
    const metrics = await win.webContents.executeJavaScript("(()=>{const editor=document.getElementById('editor'),control=document.querySelector('[data-xikii-translation-toggle]'),name=control.previousElementSibling;const b=control.getBoundingClientRect(),n=name.getBoundingClientRect();return {toolbar:!!document.getElementById('xikii-translation-toolbar'),formChildren:editor.closest('form').children.length,width:b.width,alignment:Math.abs((b.top+b.bottom-n.top-n.bottom)/2)};})()");
    assert.equal(metrics.toolbar, false); assert.equal(metrics.formChildren, 1, 'composer and typing area remain untouched');
    assert.equal(metrics.width, 24); assert(metrics.alignment <= 1, 'switch aligns with channel name');
  };
  const enter = async (text, modifiers = []) => {
    await win.webContents.executeJavaScript(`document.getElementById('editor').textContent=${JSON.stringify(text)};document.getElementById('editor').focus();`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers });
  };
  await enter('你好');
  await until(async () => (await win.webContents.executeJavaScript('window.sent')).length === 1, 'direct translated send without preview');
  assert.deepEqual(await win.webContents.executeJavaScript('window.sent'), ['Hello']);
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('editor').innerText"), '');
  await win.webContents.executeJavaScript('window.sent=[]');
  const beforeRaw = apiCalls;
  await enter('原文快捷键测试', ['control']);
  await until(async () => (await win.webContents.executeJavaScript('window.sent')).length === 1, 'raw shortcut sends once');
  assert.deepEqual(await win.webContents.executeJavaScript('window.sent'), ['原文快捷键测试']);
  assert.equal(apiCalls, beforeRaw, 'Ctrl+Enter does not call a translation provider');
  await win.webContents.executeJavaScript('window.sent=[]');
  fs.mkdirSync(path.resolve(root, 'cache/evidence'), { recursive: true });
  win.webContents.invalidate();
  await wait(250);
  fs.writeFileSync(path.resolve(root, 'cache/evidence/translation-switches.png'), (await win.webContents.capturePage()).toPNG());
  await checkLayout();
  win.setSize(680, 700); win.webContents.invalidate(); await wait(250);
  await checkLayout();
  fs.writeFileSync(path.resolve(root, 'cache/evidence/translation-switches-narrow.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(1100, 800); await wait(100);
  const switchPoint = await win.webContents.executeJavaScript("(()=>{const r=document.querySelectorAll('[data-xikii-translation-toggle]')[1].getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...switchPoint});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...switchPoint});
  await until(() => win.webContents.executeJavaScript("document.querySelectorAll('[data-xikii-translation-toggle]')[1].getAttribute('aria-checked')==='true'"), 'non-current channel switch click');
  assert.equal(win.webContents.getURL(), 'https://discord.com/channels/@me/123', 'switch click must not navigate');
  // A trusted settings window uses the same production IPC controls.
  const settings = new BrowserWindow({ show: false, width: 1150, height: 1000, webPreferences: { preload: path.resolve(__dirname, 'electron-settings-preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  attachTranslation(settings, true);
  await settings.loadFile(path.resolve(root, 'sources/assets/web/html/settings.html'));
  await until(() => settings.webContents.executeJavaScript(`!!document.querySelector('.xikii-settings-form button')`), 'settings form');
  assert.deepEqual(await settings.webContents.executeJavaScript(`Array.from(document.querySelector('.xikii-settings-form select').options, option => option.value)`), ['en', 'zh']);
  assert.deepEqual(await settings.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tabpanel]'), panel => panel.hidden)`), [false, true]);
  await settings.webContents.executeJavaScript(`document.getElementById('settings-tab-client').click();`);
  assert.deepEqual(await settings.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tabpanel]'), panel => panel.hidden)`), [true, false]);
  await until(() => settings.webContents.executeJavaScript("!!document.getElementById('desktop-save')"), 'desktop settings form');
  assert.equal(await settings.webContents.executeJavaScript("document.getElementById('desktop-startup').disabled"), true, 'development Electron cannot install a startup entry');
  const desktopPoint = await settings.webContents.executeJavaScript("(()=>{document.getElementById('desktop-notifications').value='allow';document.getElementById('desktop-flash').checked=false;const button=document.getElementById('desktop-save');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  settings.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...desktopPoint});
  settings.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...desktopPoint});
  await until(() => settings.webContents.executeJavaScript("document.querySelector('#xikii-desktop-settings [role=status]').textContent.includes('已保存')"), 'desktop preferences save');
  const { desktopState } = require('../app/code/main/modules/desktop.js');
  assert.equal(desktopState().notifications, true); assert.equal(desktopState().flash, false); assert.equal(desktopState().persistentSession, true);
  settings.webContents.invalidate(); await wait(250);
  fs.writeFileSync(path.resolve(root, 'cache/evidence/desktop-settings.png'), (await settings.webContents.capturePage()).toPNG());
  await settings.webContents.executeJavaScript(`document.getElementById('settings-tab-translation').click();`);
  settings.webContents.invalidate();
  await wait(250);
  fs.writeFileSync(path.resolve(root, 'cache/evidence/translation-settings.png'), (await settings.webContents.capturePage()).toPNG());
  // Drive a real, trusted submit through Chromium input (no synthetic click bypass).
  const save = await settings.webContents.executeJavaScript(`(()=>{const boxes=document.querySelectorAll('#xikii-translation-settings input[type=checkbox]');boxes[2].checked=false;boxes[3].checked=true;const button=document.querySelector('button[type=submit]');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  settings.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...save });
  settings.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...save });
  await until(() => settings.webContents.executeJavaScript(`document.querySelector('[role=status]').textContent.includes('已保存')`), 'save settings');
  await until(() => win.webContents.executeJavaScript(`document.getElementById('message-content-1001').style.display==='none' && document.querySelector('[data-xikii-translation]')?.textContent==='你好'`), 'streaming translation hides original only after completion');
  await until(() => win.webContents.executeJavaScript(`document.querySelector('[data-xikii-translation-toggle]').getAttribute('aria-checked')==='true'`), 'enabled DM sidebar badge');
  await wait(250);
  await enter('你好，自动发送');
  await until(async () => (await win.webContents.executeJavaScript('window.sent')).length === 1, 'automatic send');
  assert.deepEqual(await win.webContents.executeJavaScript('window.sent'), ['Hello']);
  assert(streamCalls >= 2, 'incoming and outgoing must use streaming when enabled');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control', 'alt'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control', 'alt'] });
  await until(() => win.webContents.executeJavaScript(`document.getElementById('message-content-1001').style.display==='' && document.querySelectorAll('[data-xikii-translation]').length===0 && document.querySelector('[data-xikii-translation-toggle]').getAttribute('aria-checked')==='false'`), 'shortcut disables translation and restores original');
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
  providerUnavailable = true;
  await enter('失败时保留此草稿');
  await wait(150);
  assert.deepEqual(await win.webContents.executeJavaScript('window.sent'), ['Hello']);
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('editor').innerText"), '失败时保留此草稿');
  const fallbackSave = await settings.webContents.executeJavaScript(`(()=>{document.querySelectorAll('#xikii-translation-settings input[type=checkbox]')[4].checked=true;document.querySelector('input[type=url]').value='https://fallback.test/translate';document.querySelectorAll('input[type=password]')[1].value='fixture-fallback-key';document.querySelector('[role=status]').textContent='';const button=document.querySelector('button[type=submit]');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  settings.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...fallbackSave });
  settings.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...fallbackSave });
  await until(() => settings.webContents.executeJavaScript(`document.querySelector('[role=status]').textContent.includes('已保存')`), 'fallback settings saved');
  assert(!fs.readFileSync(path.resolve(profile, 'translation.json'), 'utf8').includes('fixture-fallback-key'));
  await win.webContents.executeJavaScript(`const li=document.createElement('li');li.id='chat-messages-456-2001';li.innerHTML='<div id="message-content-2001">Hello again</div>';document.querySelector('ol').append(li);`);
  await until(() => win.webContents.executeJavaScript(`document.getElementById('message-content-2001').nextElementSibling?.textContent==='备用你好'`), 'incoming uses fallback');
  assert.equal(await win.webContents.executeJavaScript(`document.getElementById('message-content-2001').nextElementSibling.title`), '译文来自备用引擎 LibreTranslate');
  await enter('你好，备用翻译测试');
  await until(async () => (await win.webContents.executeJavaScript('window.sent')).length === 2, 'automatic send uses fallback once');
  assert.deepEqual(await win.webContents.executeJavaScript('window.sent'), ['Hello', 'Fallback hello']);
  assert.equal(fallbackCalls, 2, JSON.stringify(fallbackRequests));
  settings.webContents.invalidate(); await wait(250);
  fs.writeFileSync(path.resolve(root, 'cache/evidence/translation-fallback-settings.png'), (await settings.webContents.capturePage()).toPNG());
  providerUnavailable = false; providerDelay = 0;
  win.setSize(680, 850);
  await win.webContents.executeJavaScript(`const long=document.createElement('li');long.id='chat-messages-456-2002';long.style.lineHeight='12px';long.innerHTML='<div id="message-content-2002">Long paragraph fixture</div>';document.querySelector('ol').append(long);`);
  await until(() => win.webContents.executeJavaScript(`document.getElementById('message-content-2002').nextElementSibling?.textContent.endsWith('更加轻松。')`), 'long Chinese translation');
  const typography = await win.webContents.executeJavaScript(`(()=>{const node=document.getElementById('message-content-2002').nextElementSibling;const css=getComputedStyle(node),range=document.createRange();range.selectNodeContents(node);return {font:parseFloat(css.fontSize),line:parseFloat(css.lineHeight),tops:[...new Set(Array.from(range.getClientRects(),r=>Math.round(r.top*100)/100))].sort((a,b)=>a-b)};})()`);
  assert(Math.abs(typography.line / typography.font - 1.6) < .01, 'Chinese line height is independent of parent');
  assert(typography.tops.length >= 4, 'exercise actual wrapped Chinese lines');
  const distances = typography.tops.slice(1).map((top, index) => top - typography.tops[index]);
  assert(distances.every(gap => gap >= typography.line - 1), 'wrapped line baselines never collapse');
  win.webContents.invalidate(); await wait(200);
  fs.writeFileSync(path.resolve(root, 'cache/evidence/translation-chinese-spacing.png'), (await win.webContents.capturePage()).toPNG());
  const output = { passed: ['encrypted-key-storage', 'incoming-render', 'direct-send-without-preview', 'settings-save', 'chinese-english-options-only', 'settings-tabs', 'desktop-notification-preferences-save', 'development-startup-disabled', 'streaming-incoming-and-outgoing', 'hide-original-after-success', 'sidebar-translation-switch', 'shortcut-toggle-restores-original', 'automatic-send-once', 'edited-draft-not-sent', 'navigation-not-sent', 'conversation-isolation', 'independent-encrypted-provider-keys', 'changed-endpoint-clears-fallback-key', 'fallback-settings-save', 'fallback-incoming-provider-label', 'fallback-automatic-send-once', 'wide-and-narrow-no-toolbar-or-composer-overlap', 'channel-switch-inline-alignment', 'non-current-channel-switch-click-without-navigation', 'wrapped-chinese-line-height', 'raw-shortcut-without-api', 'failed-translation-keeps-draft'], apiCalls, streamCalls, fallbackCalls, externalNetwork: false };
  fs.writeFileSync(path.resolve(root, 'cache/evidence/smoke-result.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
  settings.destroy(); win.destroy(); app.exit(0);
}
main().catch(error => { console.error(error); app.exit(1); });



