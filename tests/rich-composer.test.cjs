const {test}=require('node:test');const assert=require('node:assert/strict');const {JSDOM}=require('jsdom');
const {snapshotComposer,translatedSegments,replaceRichComposer}=require('../app/code/renderer/modules/rich-composer.js');
function fixture(){const {document}=new JSDOM('<div id="editor" contenteditable="true"><div data-slate-node="element"><span>你好 </span><span data-slate-void="true"><span data-slate-zero-width="z">\uFEFF</span><span contenteditable="false">@测试</span></span><span> 谢谢</span></div><div data-slate-node="element"><span>第二段</span></div></div>').window;return document.getElementById('editor');}
void test('rich snapshot protects the whole mention and paragraph, excluding hidden Slate spacers',()=>{
 const snapshot=snapshotComposer(fixture(),'TEST');assert.deepEqual(snapshot.segments.map(s=>s.text),['你好 ',' 谢谢','第二段']);assert.equal(snapshot.markers.length,2);assert(!snapshot.text.includes('@测试'));assert(!snapshot.text.includes('\uFEFF'));
 assert.deepEqual(translatedSegments(snapshot,`Hello ${snapshot.markers[0]} thank you${snapshot.markers[1]}Second paragraph`),['Hello ',' thank you','Second paragraph']);
});
void test('missing, duplicated or reordered rich markers are rejected before any editor mutation',()=>{
 const snapshot=snapshotComposer(fixture(),'TEST');const [a,b]=snapshot.markers;
 assert.throws(()=>translatedSegments(snapshot,`Hello ${a}`));assert.throws(()=>translatedSegments(snapshot,`${a}${b}${a}`));assert.throws(()=>translatedSegments(snapshot,`${b}${a}`));
});
void test('a changed mention or user draft prevents all planned edits',async()=>{
 const editor=fixture(),original=snapshotComposer(editor,'TEST');editor.querySelector('[contenteditable=false]').textContent='@另一个人';let edits=0;
 await assert.rejects(replaceRichComposer(editor,'TEST',original,original.text.replace('你好','Hello'),()=>true,async()=>{edits++;}));assert.equal(edits,0);
});
