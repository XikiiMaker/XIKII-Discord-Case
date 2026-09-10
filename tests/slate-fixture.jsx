import React, {useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {createEditor, Transforms, Editor} from 'slate';
import {Slate, Editable, withReact} from 'slate-react';
const initial=[{type:'paragraph',children:[{text:'你好 '},{type:'mention',id:'123',label:'@测试用户',children:[{text:''}]},{text:' 请查看 '},{type:'emoji',id:'789',label:'👋',children:[{text:''}]},{text:' 谢谢'}]}];
function App(){
 const editor=useMemo(()=>{const e=withReact(createEditor());const {isInline,isVoid}=e;e.isInline=node=>node.type==='mention'||node.type==='emoji'||isInline(node);e.isVoid=node=>node.type==='mention'||node.type==='emoji'||isVoid(node);return e;},[]);
 window.fixtureModel=()=>JSON.parse(JSON.stringify(editor.children));
 window.fixtureSet=value=>{Editor.withoutNormalizing(editor,()=>{Transforms.removeNodes(editor,{at:[0]});Transforms.insertNodes(editor,value,{at:[0]});});};
 window.sent=[];
 return <Slate editor={editor} initialValue={initial}><Editable role="textbox" renderElement={({attributes,children,element})=>element.type==='mention'||element.type==='emoji'?<span {...attributes} contentEditable={false} data-fixture-id={element.id} style={{background:'#414675',borderRadius:4,padding:'2px 4px'}}>{children}{element.label}</span>:<div {...attributes}>{children}</div>} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.sent.push(window.fixtureModel());}}}/></Slate>;
}
createRoot(document.getElementById('root')).render(<App/>);
