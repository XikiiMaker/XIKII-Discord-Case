// Real React/Slate editor, production preload and main IPC, artificial messages only.
const {app,BrowserWindow,session}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');const profile=path.join(root,'cache','slate-'+Date.now());fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setAppPath(root);app.disableHardwareAcceleration();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<100;i++){
 // Wait for the actual editor state before proceeding.
 // oxlint-disable-next-line no-await-in-loop
 if(await check())return;
 // oxlint-disable-next-line no-await-in-loop
 await wait(30);
}throw Error('Timed out: '+label);}
async function main(){
 await app.whenReady();
 const bundle=esbuild.buildSync({entryPoints:[path.join(__dirname,'slate-fixture.jsx')],bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"production"'}}).outputFiles[0].text;
 let calls=0,delay=0,mode='normal';const requests=[];
 session.defaultSession.protocol.handle('https',async request=>{
  const url=new URL(request.url);
  if(url.hostname==='discord.com')return new Response(url.pathname==='/fixture.js'?bundle:'<!doctype html><html><head><meta charset="utf-8"><style>body{background:#313338;color:white;font:18px/1.6 system-ui;padding:24px} [role=textbox]{padding:16px;background:#383a40;min-height:100px;outline:none}</style></head><body><main><h3>Slate 富文本翻译 · 本地模拟</h3><form><div id="root"></div></form></main><script src="/fixture.js"></script></body></html>',{headers:{'Content-Type':url.pathname==='/fixture.js'?'text/javascript':'text/html'}});
  if(url.hostname.startsWith('dashscope')){calls++;const body=JSON.parse(await request.text());requests.push(body.messages.at(-1).content);await wait(delay);let content=body.messages.at(-1).content.replaceAll('你好','Hello').replaceAll('请查看','please check').replaceAll('谢谢','thank you');if(mode==='move')content=content.replace('Hello ','')+' Hello';return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));}
  return new Response('Blocked',{status:403});
 });
 const {TranslationStore}=require('../app/code/main/translation/store.js');const {defaultTranslationSettings}=require('../app/code/common/translation.js');const {attachTranslation}=require('../app/code/main/translation/ipc.js');
 new TranslationStore().save({...defaultTranslationSettings,consent:true},'synthetic-test-key');
 const win=new BrowserWindow({show:false,width:950,height:500,webPreferences:{preload:path.join(__dirname,'electron-preload.cjs'),sandbox:false,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});attachTranslation(win);
 await win.loadURL('https://discord.com/channels/@me/123');await until(()=>win.webContents.executeJavaScript('!!window.fixtureModel'),'Slate ready');await wait(200);
 const before=await win.webContents.executeJavaScript('window.fixtureModel()');
 const enter=async()=>{await win.webContents.executeJavaScript("document.querySelector('[role=textbox]').focus()");win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});};
 await enter();
 try{await until(async()=>(await win.webContents.executeJavaScript('window.sent')).length===1,'rich translated send');}catch(error){console.error(JSON.stringify({requests,model:await win.webContents.executeJavaScript('window.fixtureModel()'),html:await win.webContents.executeJavaScript("document.querySelector('[role=textbox]').innerHTML")}));throw error;}
 const sent=await win.webContents.executeJavaScript('window.sent[0]');
 assert.equal(sent[0].children[0].text,'Hello ');assert.equal(sent[0].children[2].text,' please check ');assert.equal(sent[0].children[4].text,' thank you');
 assert.deepEqual(sent[0].children[1],before[0].children[1]);assert.deepEqual(sent[0].children[3],before[0].children[3]);assert.equal(calls,1);assert(!JSON.stringify(sent).includes('XIKII_NODE_'));
 win.webContents.invalidate();await wait(200);fs.writeFileSync(path.join(root,'cache/evidence/slate-rich-composer.png'),(await win.webContents.capturePage()).toPNG());
 await win.webContents.executeJavaScript('window.sent=[]');
 await win.webContents.executeJavaScript('window.fixtureSet('+JSON.stringify(before)+')');await wait(100);await enter();
 await until(async()=>(await win.webContents.executeJavaScript('window.sent')).length===1,'repeated rich draft');assert.equal(calls,1,'identical rich text must hit the cache');
 delay=350;const edited=structuredClone(before);edited[0].children[0].text='你好 请查看 ';
 await win.webContents.executeJavaScript('window.fixtureSet('+JSON.stringify(edited)+')');await wait(100);await enter();await wait(100);await win.webContents.executeJavaScript("window.fixtureSet([{type:'paragraph',children:[{text:'用户修改的新草稿'}]}])");await wait(450);assert.equal((await win.webContents.executeJavaScript('window.sent')).length,1,'editing cannot send an old rich draft');
 delay=0;mode='move';const boundary=[{type:'paragraph',children:[{text:'你好 '},before[0].children[1],{text:''}]}];
 await win.webContents.executeJavaScript('window.fixtureSet('+JSON.stringify(boundary)+')');await wait(100);await enter();
 await until(async()=>(await win.webContents.executeJavaScript('window.sent')).length===2,'empty edge leaf and deleted prefix');
 const moved=await win.webContents.executeJavaScript('window.sent[1]');assert.deepEqual(moved[0].children,[{text:''},before[0].children[1],{text:' Hello'}]);
 mode='normal';const paragraphs=[{type:'paragraph',children:[{text:''},before[0].children[1],{text:' 你好'}]},{type:'paragraph',children:[{text:'谢谢 '},before[0].children[3],{text:''}]}];
 await win.webContents.executeJavaScript('window.fixtureSet('+JSON.stringify(paragraphs)+')');await wait(100);await enter();
 await until(async()=>(await win.webContents.executeJavaScript('window.sent')).length===3,'multiple paragraphs');
 const multi=await win.webContents.executeJavaScript('window.sent[2]');assert.equal(multi.length,2);assert.equal(multi[0].children[2].text,' Hello');assert.equal(multi[1].children[0].text,'thank you ');assert.deepEqual(multi[1].children[1],before[0].children[3]);
 const result={passed:['native-slate-mention-preserved','native-slate-custom-emoji-preserved','rich-prose-translated-and-sent-once','rich-edit-cancellation','rich-cache-hit','empty-edge-leaf-and-prefix-deletion','multiple-rich-paragraphs'],calls,externalNetwork:false};fs.writeFileSync(path.join(root,'cache/evidence/slate-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));win.destroy();app.exit(0);
}
main().catch(error=>{console.error(error);app.exit(1)});
