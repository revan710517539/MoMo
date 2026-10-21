import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OpenCodeEngine, validateBundle, buildPrompt } = require('../electron/opencode.cjs');

const valid = () => ({ title:'文字计数', description:'统计本机输入文字', html:'<textarea id="text"></textarea><output id="count">0</output>', css:'output{color:purple}', js:'document.getElementById("text").addEventListener("input",event=>{document.getElementById("count").textContent=String(event.target.value.length)});', permissions:[], inputHint:'输入文字' });
const configured = { provider:'custom', baseURL:'https://example.invalid/v1', model:'test-model', apiKey:'fixture-test-key-never-live' };
async function temporary(t) { const root=await fs.mkdtemp(path.join(os.tmpdir(),'momo-engine-test-')); t.after(()=>fs.rm(root,{recursive:true,force:true})); return root; }
async function cliFixture(root, behavior) {
  const file=path.join(root,'fixture-cli');
  await fs.writeFile(file, `#!${process.execPath}\nconst fs=require('node:fs');\nif(process.argv.includes('--version')){console.log('1.19.3');process.exit(0)}\n${behavior}\n`, {mode:0o700});
  return file;
}

test('bundle gate accepts source but rejects unsupported capabilities and dangerous resources', () => {
  assert.deepEqual(validateBundle(valid()),valid());
  for (const patch of [
    {permissions:['bash']}, {extra:'unexpected'}, {html:'<iframe src="x"></iframe>'},
    {html:'<button onclick="alert(1)">Go</button>'}, {html:'<a href="https://example.com">Go</a>'},
    {html:'<script>alert(1)</script>'}, {css:'@import "x"'}, {css:'div{background:url(x)}'},
    {js:'fetch("x")'}, {js:'require("fs")'}, {js:'process.exit()'}, {js:'new Function("return 1")'},
    {title:'x'.repeat(101)}, {html:''}, {inputHint:null},
  ]) assert.throws(()=>validateBundle({...valid(),...patch}),{code:'INVALID_BUNDLE'});
});

test('prompt uses actual host bridge and preserves revision as untrusted source', () => {
  const prompt=buildPrompt({request:'把字体放大',previous:valid()});
  assert.match(prompt,/window\.momo\.pickFiles/); assert.match(prompt,/readFile\(id\)/);
  assert.match(prompt,/saveText\(\{name:/); assert.match(prompt,/Do not call any agent tools/);
  assert.match(prompt,/PREVIOUS TOOL TO REVISE/); assert.match(prompt,/把字体放大/);
  assert.throws(()=>buildPrompt({request:' '}),{code:'INVALID_REQUEST'});
});

test('no provider configuration fails explicitly without invoking any binary', async t => {
  const root=await temporary(t); const events=[];
  const engine=new OpenCodeEngine({userData:root,binaryPath:'/not-installed',getSettings:()=>({}),onEvent:e=>events.push(e)});
  await assert.rejects(engine.generate({id:'missing',request:'做工具'}),{code:'NOT_CONFIGURED'});
  const status=await engine.status(); assert.equal(status.configured,false); assert.equal(status.installed,false);
  assert.ok(events.some(e=>e.status==='error')); await engine.close();
});

test('provider addresses reject credentials, query strings, remote plaintext and config interpolation', async t => {
  const root=await temporary(t);
  for (const baseURL of ['http://example.com/v1','https://user:pass@example.com/v1','https://example.com/v1?key=secret','https://example.com/{env:SECRET}']) {
    const engine=new OpenCodeEngine({userData:root,getSettings:()=>({...configured,baseURL})});
    await assert.rejects(engine.generate({id:'bad',request:'做工具'}),{code:'INVALID_SETTINGS'}); await engine.close();
  }
});

test('CLI protocol fixture verifies isolated environment, stdin, deny policy and source-only output', async t => {
  const root=await temporary(t), expected=valid();
  const binary=await cliFixture(root, `
const config=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
if(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || config.permission['*']!=='deny' || config.tools.bash!==false || !process.argv.includes('--pure') || process.argv.join(' ').includes('fixture-test-key')) process.exit(12);
if(!process.cwd().startsWith(fs.realpathSync(process.env.HOME).replace(/home$/,'')) || !process.env.XDG_DATA_HOME.startsWith(process.env.HOME.replace(/home$/,''))) process.exit(13);
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
if(!input.includes('制作计数器')||!input.includes('window.momo.pickFiles'))process.exit(14);
console.log(JSON.stringify({type:'step_start'}));
console.log(JSON.stringify({type:'text',part:{type:'text',text:JSON.stringify(${JSON.stringify(expected)})}}));
console.log(JSON.stringify({type:'step_finish'}));});`);
  const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-inherited-key';
  t.after(()=>{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;});
  const events=[], engine=new OpenCodeEngine({userData:root,binaryPath:binary,getSettings:()=>configured,onEvent:e=>events.push(e)});
  assert.deepEqual(await engine.generate({id:'protocol',request:'制作计数器'}),expected);
  assert.equal((await engine.status()).version,'1.19.3');
  assert.equal(JSON.stringify(events).includes(configured.apiKey),false);
  assert.deepEqual(await fs.readdir(path.join(root,'opencode-engine')),[]);
  await engine.close();
});

test('tool calls, provider errors, malformed JSON and dangerous model output fail closed', async t => {
  const root=await temporary(t);
  for(const event of [
    {type:'tool_use',part:{type:'tool',tool:'bash'}},
    {type:'error',error:{message:configured.apiKey}},
    {type:'text',part:{text:'```json\n{}\n```'}},
    {type:'text',part:{text:JSON.stringify({...valid(),js:'process.exit()'})}},
  ]) {
    const binary=await cliFixture(root,`process.stdin.resume();process.stdin.on('end',()=>console.log(${JSON.stringify(JSON.stringify(event))}));`);
    const events=[],engine=new OpenCodeEngine({userData:root,binaryPath:binary,getSettings:()=>configured,onEvent:e=>events.push(e)});
    await assert.rejects(engine.generate({id:'invalid',request:'做工具'}),e=>['OPENCODE_ERROR','INVALID_BUNDLE'].includes(e.code));
    assert.equal(JSON.stringify(events).includes(configured.apiKey),false); await engine.close();
  }
});

test('cancel and close terminate active processes and clean private job files', async t => {
  const root=await temporary(t), binary=await cliFixture(root,'process.stdin.resume();setInterval(()=>{},1000);');
  const events=[],engine=new OpenCodeEngine({userData:root,binaryPath:binary,getSettings:()=>configured,onEvent:e=>events.push(e)});
  const pending=engine.generate({id:'cancel-me',request:'做工具'}); const rejected=assert.rejects(pending,{code:'CANCELLED'});
  while(!events.some(e=>e.status==='generating'))await new Promise(r=>setTimeout(r,10));
  assert.equal(engine.cancel('cancel-me'),true); await rejected;
  assert.deepEqual(await fs.readdir(path.join(root,'opencode-engine')),[]);
  const second=engine.generate({id:'close-me',request:'做工具'});const rejectedSecond=assert.rejects(second,{code:'CANCELLED'});
  await engine.close();await rejectedSecond;
  await assert.rejects(engine.generate({id:'closed',request:'做工具'}),{code:'CLOSED'});
  assert.equal(engine.cancel('missing'),false);
});

test('subprocess timeout is bounded and does not forward stderr credentials', async t => {
  const root=await temporary(t), binary=await cliFixture(root,`process.stderr.write(${JSON.stringify(configured.apiKey)});process.stdin.resume();setInterval(()=>{},1000);`);
  const engine=new OpenCodeEngine({userData:root}),workspace=await engine._workspace();
  await assert.rejects(engine._run(binary,[], '',workspace,{},null,50),{code:'TIMEOUT'});
  await fs.rm(workspace,{recursive:true,force:true});await engine.close();
});

// Real OpenCode executable + local OpenAI-protocol fixture. This proves CLI/API
// compatibility and tool disabling, not a real model's quality or availability.
const actualBinary=path.resolve('node_modules',`opencode-${process.platform==='win32'?'windows':process.platform}-${process.arch}`,'bin',process.platform==='win32'?'opencode.exe':'opencode');
let installed=false;try{await fs.access(actualBinary);installed=true;}catch{}
test('installed OpenCode 1.19.3 uses chat-completions fixture with no tools', {skip:!installed,timeout:30000}, async t => {
  const root=await temporary(t), seen=[], bundle=valid();
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    const body=JSON.parse(raw); seen.push({url:req.url,body});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const chunk={id:'fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(bundle)},finish_reason:null}]};
    res.write('data: '+JSON.stringify(chunk)+'\n\n');
    res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}})+'\n\n');res.end('data: [DONE]\n\n');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const engine=new OpenCodeEngine({userData:root,binaryPath:actualBinary,getSettings:()=>({...configured,baseURL:`http://127.0.0.1:${server.address().port}/v1`})});t.after(()=>engine.close());
  assert.equal((await engine.status()).version,'1.19.3');
  assert.deepEqual(await engine.generate({id:'real-cli',request:'做文字计数器'}),bundle);
  assert.equal(seen.length,1);assert.equal(seen[0].url,'/v1/chat/completions');
  assert.equal(seen[0].body.model,'test-model');assert.equal(seen[0].body.tools?.length||0,0);
  assert.ok(JSON.stringify(seen[0].body.messages).includes('做文字计数器'));
  assert.deepEqual(await fs.readdir(path.join(root,'opencode-engine')),[]);
});
