import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {OpenCodeEngine,validateBundle}=require('../electron/opencode.cjs');
const {createStore}=require('../electron/store.cjs');
const {createOptimizer}=require('../electron/optimizer.cjs');
const binary=path.resolve('node_modules',`opencode-${process.platform==='win32'?'windows':process.platform}-${process.arch}`,'bin',process.platform==='win32'?'opencode.exe':'opencode');
let installed=false;try{await fs.access(binary);installed=true;}catch{}
const source={title:'本地计数器',description:'仅用于本机协议验收',html:'<input id="text"><output id="count">0</output>',css:'output{color:green}',js:'document.getElementById("text").addEventListener("input",event=>{document.getElementById("count").textContent=String(event.target.value.length)});',permissions:[],inputHint:'输入一段文字'};

// Actual OpenCode executable and SQLite, with a loopback-only deterministic model
// fixture. This proves delivery/rollback plumbing, not real-model business quality.
test('real OpenCode candidate passes optimizer gates, applies, rolls back and survives SQLite reopen',{skip:!installed,timeout:30000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'momo-opt-real-'));let store,engine,optimizer,server;const seen=[],events=[];let databaseOpen=false;
 t.after(async()=>{await optimizer?.close();await engine?.close();if(databaseOpen)store.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await fs.rm(dir,{recursive:true,force:true});});
 const generated={...source,title:'更清晰的计数器',css:'output{color:purple;font-size:22px}'};
 server=http.createServer(async(req,res)=>{
  try{assert.equal(req.socket.remoteAddress,'127.0.0.1');let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);seen.push({url:req.url,body});
   res.writeHead(200,{'Content-Type':'text/event-stream'});const chunk={id:'optimizer-fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(generated)},finish_reason:null}]};res.write('data: '+JSON.stringify(chunk)+'\n\n');res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}})+'\n\n');res.end('data: [DONE]\n\n');
  }catch{res.writeHead(400);res.end('invalid local fixture request');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 store=createStore(path.join(dir,'data'));databaseOpen=true;
 const stable=store.saveTool({title:source.title,kind:'custom',prompt:'原始工具需求',config:{},bundle:source});
 const key='fixture-only-not-a-real-key';
 engine=new OpenCodeEngine({userData:dir,binaryPath:binary,getSettings:()=>({provider:'custom',baseURL:`http://127.0.0.1:${server.address().port}/v1`,model:'test-model',apiKey:key}),onEvent:event=>events.push(event)});
 optimizer=createOptimizer({store,engine,validateBundle});
 const candidate=await optimizer.propose({toolId:stable.id,request:'把结果字号放大、换成紫色，保留原计数规则'});
 assert.equal(candidate.status,'review');assert.equal(candidate.validation.structure,'passed');assert.equal(candidate.validation.syntax,'passed');assert.equal(candidate.validation.render,'not-run');assert.equal(candidate.validation.businessCorrectness,'not-tested');assert.deepEqual(store.listTools()[0].bundle,source);assert.equal(store.listTools()[0].version,1);
 assert.equal(seen.length,1);assert.equal(seen[0].url,'/v1/chat/completions');assert.equal(seen[0].body.tools?.length||0,0);assert.ok(JSON.stringify(seen[0].body.messages).includes('PREVIOUS TOOL TO REVISE'));assert.ok(events.every(event=>event.id.startsWith('optimizer:')));assert.ok(!JSON.stringify(events).includes(key));
 await assert.rejects(optimizer.apply({id:candidate.id,confirmed:true}),{code:'TRIAL_REQUIRED'});
 // Explicit human-trial acknowledgement is a gate marker; this fixture does not claim UI/business acceptance.
 await optimizer.markTrial({id:candidate.id,passed:true});const result=await optimizer.apply({id:candidate.id,confirmed:true});assert.equal(result.tool.version,2);assert.deepEqual(result.tool.bundle,generated);
 const restored=await optimizer.rollback({toolId:stable.id});assert.equal(restored.version,3);assert.deepEqual(restored.bundle,source);assert.equal(optimizer.getState().rollbacks.length,0);
 await optimizer.close();await engine.close();store.close();databaseOpen=false;
 store=createStore(path.join(dir,'data'));databaseOpen=true;optimizer=createOptimizer({store,engine,validateBundle});
 const reopened=store.listTools()[0];assert.equal(reopened.id,stable.id);assert.equal(reopened.version,3);assert.deepEqual(reopened.bundle,source);assert.equal(store.listVersions(stable.id).length,3);assert.equal(optimizer.getState().rollbacks.length,0);assert.equal(optimizer.getState().candidates[0].status,'rolled_back');assert.deepEqual(await fs.readdir(path.join(dir,'opencode-engine')),[]);
});
