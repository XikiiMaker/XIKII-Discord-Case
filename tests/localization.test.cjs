const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
function leaves(value,prefix=''){return Object.entries(value).flatMap(([key,item])=>key==='$schema'?[]:typeof item==='string'?[[prefix+key,item]]:leaves(item,prefix+key+'.'));}
void test('Chinese locale covers every shipped settings, menu, dialog and built-in page label',()=>{
  for(const file of ['settings','client','web']){
    const read=locale=>JSON.parse(fs.readFileSync(path.join(__dirname,'../sources/translations',locale,file+'.json'),'utf8'));
    const english=leaves(read('en'));const chinese=new Map(leaves(read('zh-CN')));
    assert.deepEqual([...chinese.keys()].sort((a,b)=>a.localeCompare(b)),english.map(([key])=>key).sort((a,b)=>a.localeCompare(b)));
    for(const [key,original] of english){const translated=chinese.get(key);assert.match(translated,/\p{Script=Han}/u,`${file}.${key} lacks Chinese text`);assert.equal((translated.match(/%s/g)||[]).length,(original.match(/%s/g)||[]).length,`${key} lost a substitution`);}
  }
});
