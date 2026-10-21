import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntimeDocument } from '../src/runtime-document.js';
const token='testToken0123456789';
test('runtime denies network, frames, forms, eval and external images',()=>{
 const html=buildRuntimeDocument({html:'<h1>工具</h1>',js:'window.x=1'},{token});
 assert.match(html,/default-src 'none'/); assert.match(html,/connect-src 'none'/); assert.match(html,/frame-src 'none'/); assert.match(html,/form-action 'none'/); assert.match(html,/img-src data: blob:/); assert.match(html,/base-uri 'none'/); assert.doesNotMatch(html,/unsafe-eval/);
 assert.match(html,new RegExp(`script-src 'nonce-${token}'`));
});
test('runtime bridge requires parent source and exact token; keeps generated JavaScript in iframe document',()=>{
 const html=buildRuntimeDocument({js:'document.body.dataset.ready="yes"'},{token});
 assert.match(html,/event.source!==parent/); assert.match(html,/d.token!==token/); assert.match(html,/Object.freeze/);assert.match(html,/runtime|momoReady/);assert.match(html,/document.body.dataset.ready/);
});
test('script and style closing payload cannot escape generated containers',()=>{
 const html=buildRuntimeDocument({css:'body{color:red}</style><script>alert(1)</script>',js:'const example="</script><script>alert(2)</script>";'},{token});
 const generated = html.slice(html.lastIndexOf('<script nonce='));
 assert.equal((generated.match(/<\/script>/gi)||[]).length,1);
 assert.match(html,/<\\\/script>/);assert.match(html,/<\\\/style>/);
});
test('rejects invalid tokens, field types and oversized bundles',()=>{
 assert.throws(()=>buildRuntimeDocument({}, {token:'bad"/>'}));
 assert.throws(()=>buildRuntimeDocument({js:{}},{token}),/格式/);
 assert.throws(()=>buildRuntimeDocument({html:'中'.repeat(800000)},{token}),/2 MB/);
});

import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
function bridgeHarness() {
 const document=buildRuntimeDocument({html:'<div>测试</div>',js:''},{token});
 const source=document.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
 const events={}, messages=[], timers=new Map();let timerID=0;
 const parent={postMessage:(data)=>messages.push(data)};
 const context={parent,window:{},Map,Promise,Error,Object,addEventListener:(name,fn)=>{(events[name]??=[]).push(fn);},setTimeout:fn=>{const id=++timerID;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source,context);
 return {api:context.window.momo,messages,timers,respond:(data,source=parent)=>events.message.forEach(fn=>fn({source,data})),parent};
}
test('bridge maps native payloads and accepts responses only from parent and current run',async()=>{
 const h=bridgeHarness();
 const pending=h.api.readFile('picked-file');const sent=h.messages.at(-1);
 assert.equal(sent.capability,'readFile');assert.equal(sent.args.id,'picked-file');
 h.respond({momoResponse:true,token,id:sent.id,result:'bad'},{postMessage(){}});
 assert.equal(h.timers.size,1);
 h.respond({momoResponse:true,token:'otherToken',id:sent.id,result:'bad'});
 assert.equal(h.timers.size,1);
 h.respond({momoResponse:true,token,id:sent.id,result:{text:'内容'}});
 assert.equal((await pending).text,'内容');assert.equal(h.timers.size,0);
});
test('native permission rejection reaches the tool as a rejected promise',async()=>{
 const h=bridgeHarness();const pending=h.api.readClipboard();const id=h.messages.at(-1).id;
 h.respond({momoResponse:true,token,id,error:'这项本机能力尚未授权，请点击「授权本机能力」'});
 await assert.rejects(pending,/尚未授权/);
 assert.equal(h.timers.size,0);
});
test('unanswered native requests timeout rather than hanging indefinitely',async()=>{
 const h=bridgeHarness();const pending=h.api.saveText({name:'结果.txt',content:'hello'});
 [...h.timers.values()][0]();await assert.rejects(pending,/等待太久/);
});
test('desktop native method contract exists; iframe has no same-origin grant',async()=>{
 const preload=await readFile(new URL('../electron/preload.cjs',import.meta.url),'utf8');
 const component=await readFile(new URL('../src/CustomTool.jsx',import.meta.url),'utf8');
 const methods=[...component.matchAll(/desktopCall\('([^']+)'/g)].map(match=>match[1]);
 for(const method of new Set(methods))assert.ok(preload.includes(`'${method}'`),`missing preload method ${method}`);
 assert.match(component,/sandbox="allow-scripts"/);assert.doesNotMatch(component,/allow-same-origin/);
 assert.match(component,/event\.source!==frame\.current\?\.contentWindow/);
 assert.match(component,/data\.token!==token/);assert.match(component,/工具打开超时/);
 assert.match(component,/if\(revoke\)setReload/);
});

// Legal end-to-end fixture: paste this object as bundle of a custom saved tool.
const nativeFixture = {
 title:'本机能力验收工具', description:'用来验证读取、保存、剪贴板和授权状态。',inputHint:'先授权，再选择动作。',
 permissions:['file.read','file.write','clipboard.read','clipboard.write','notification','app.open'],
 html:'<h1>小小工作台</h1><p>选择一个动作，结果会出现在下方。</p><button id="pick">读取文件</button> <button id="save">保存结果</button> <button id="clip">读取剪贴板</button> <button id="copy">复制文字</button> <button id="notice">完成提醒</button> <button id="output">打开保存结果</button><pre id="result" role="status">准备好了</pre>',
 css:'button{background:#e4eddb;border:0;border-radius:12px;padding:12px;margin:4px;color:#3c5130}pre{white-space:pre-wrap;background:#fff;padding:20px;border-radius:16px}',
 js:`let outputId;const show=value=>document.getElementById('result').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);const action=(id,fn)=>document.getElementById(id).addEventListener('click',async()=>{try{await fn();}catch(e){show(e.message);}});action('pick',async()=>{const selection=await window.momo.pickFiles({multiple:false});if(selection.canceled){show('已取消选择');return;}show(await window.momo.readFile(selection.files[0].id));});action('save',async()=>{const result=await window.momo.saveText({name:'Momo验收.txt',content:'这是通过受控运行时保存的结果。'});outputId=result.id;show(result.canceled?'已取消保存':result);});action('clip',async()=>show(await window.momo.readClipboard()));action('copy',async()=>show(await window.momo.writeClipboard('Momo本机验收')));action('notice',async()=>show(await window.momo.notify({title:'Momo',body:'工具运行完成'})));action('output',async()=>{if(!outputId){show('请先保存结果');return;}show(await window.momo.openOutput(outputId));});`
};
test('native UI fixture passes production bundle validation and builds isolated document',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {validateBundle}=require('../electron/opencode.cjs');
 assert.deepEqual(validateBundle(nativeFixture),nativeFixture);
 const html=buildRuntimeDocument(nativeFixture,{token});
 assert.match(html,/小小工作台/);assert.match(html,/window\.momo\.pickFiles/);
});
