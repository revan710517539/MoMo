import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {compareTables} from '../src/table-engine.js';

const require=createRequire(import.meta.url);
const {createStore}=require('../electron/store.cjs');
const {createCompanion}=require('../electron/companion.cjs');
const {createOptimizer}=require('../electron/optimizer.cjs');
const {createCapabilities}=require('../electron/capabilities.cjs');
const {validateBundle}=require('../electron/opencode.cjs');

// These are offline integration tests. App metadata and native dialog choices are
// injected; SQLite, observation rules, filesystem operations and versioning are real.
// They do not prove GUI interaction, OS observation or successful model generation.
function session(t,{engine}={}){
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'momo-journey-')));
  const store=createStore(path.join(directory,'profile'));
  let app={bundleId:'com.apple.Notes',name:'Notes'},selected=[];
  const companion=createCompanion({store,getTools:()=>store.listTools(),emit:()=>{},notify:()=>{},getIdleSeconds:()=>0,isActive:()=>true,getFrontmost:async()=>app});
  const optimizer=createOptimizer({store,engine,validateBundle,canAutoOptimize:()=>companion.getState().runtime.observing&&companion.getState().settings.observation.inApp});
  const capabilities=createCapabilities({store,getWindow:()=>null,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:selected}),showMessageBox:async()=>({response:1})}});
  companion.start();
  t.after(async()=>{companion.stop();await optimizer.close();store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const use=async(tool,config,usageId)=>{
    companion.recordUsage({toolId:tool.id,kind:tool.kind,config});
    return optimizer.autoOptimizeUsage({toolId:tool.id,config,usageId,succeeded:true});
  };
  return {directory,store,companion,optimizer,capabilities,use,setApp:value=>{app=value;},select:files=>{selected=files;}};
}

test('same session: three observed spreadsheet returns recommend compare; three real comparisons require review before version change',async t=>{
  const f=session(t),tool=f.store.saveTool({title:'表格核对',kind:'compare',config:{key:'原编号',amount:''}});
  f.store.saveSettings({autoOptimizeSettings:true,memoryEnabled:true});
  f.companion.updateSettings({observation:{frontmost:true,inApp:true}});
  for(let i=0;i<3;i++){
    f.setApp({bundleId:'com.apple.Notes',name:'Notes'});await f.companion.tick();
    f.setApp({bundleId:'com.microsoft.Excel',name:'Microsoft Excel'});await f.companion.tick();
  }
  const suggestion=f.companion.getState().suggestions.find(s=>s.kind==='app');
  assert.equal(suggestion.evidence.count,3);
  const accepted=f.companion.suggestionAction({id:suggestion.id,action:'accept'});
  assert.deepEqual(accepted.intent,{type:'open-tool',toolId:tool.id});
  assert.equal(f.store.listTools()[0].version,1); // Accepting opens; it never runs or changes a tool.
  const config={key:'编号',amount:'金额'};
  let learned;
  for(let i=0;i<3;i++){
    const result=compareTables([{编号:'A',金额:'10'}],[{编号:'A',金额:'12'}],config.key,config.amount);
    assert.equal(result.counts.changed,1);
    learned=await f.use(tool,config,`compare:${i}`);
  }
  assert.equal(learned.reviewRequired,true);
  assert.equal(f.store.listTools()[0].version,1);
  await assert.rejects(f.optimizer.apply({id:learned.candidate.id,confirmed:true}),{code:'TRIAL_REQUIRED'});
  await f.optimizer.markTrial({id:learned.candidate.id,passed:true});
  assert.equal((await f.optimizer.apply({id:learned.candidate.id,confirmed:true})).tool.version,2);
  assert.equal((await f.optimizer.rollback({toolId:tool.id})).version,3);
  assert.deepEqual(f.store.listVersions(tool.id).find(v=>v.version===1).config,{key:'原编号',amount:''});
});

test('same session: three actual file renames trigger usage suggestion and automatic default; rollback preserves v1 without undoing files',async t=>{
  const f=session(t),tool=f.store.saveTool({title:'资料改名',kind:'rename',config:{prefix:'原资料'}}),config={prefix:'客户资料'};
  f.store.saveSettings({autoOptimizeSettings:true,memoryEnabled:true});
  f.companion.updateSettings({observation:{inApp:true}});
  const outputs=[];
  let optimized;
  for(let i=0;i<3;i++){
    const dir=path.join(f.directory,`batch-${i}`);fs.mkdirSync(dir);
    const source=path.join(dir,'原名称.txt');fs.writeFileSync(source,`batch ${i}`);
    f.select([source]);
    const picked=await f.capabilities.pickFiles();
    const plan=f.capabilities.planRename({fileIds:picked.files.map(file=>file.id),prefix:config.prefix});
    const result=await f.capabilities.executeRename({planId:plan.id});
    assert.equal(f.store.getOperation(result.operationId).status,'completed');
    const output=path.join(dir,'客户资料_001.txt');outputs.push(output);
    assert.equal(fs.readFileSync(output,'utf8'),`batch ${i}`);
    optimized=await f.use(tool,config,result.operationId);
    assert.equal(f.store.listTools()[0].version,i<2?1:2);
  }
  const suggestion=f.companion.getState().suggestions.find(s=>s.kind==='usage');
  assert.equal(suggestion.evidence.count,3);
  assert.equal(f.companion.suggestionAction({id:suggestion.id,action:'accept'}).intent.toolId,tool.id);
  assert.equal(optimized.automatic,true);
  assert.deepEqual(f.store.listTools()[0].config,config);
  assert.equal(f.optimizer.getState().rollbacks[0].stableVersion,1);
  const rolledBack=await f.optimizer.rollback({toolId:tool.id});
  assert.equal(rolledBack.version,3);
  assert.deepEqual(rolledBack.config,{prefix:'原资料'});
  assert.deepEqual(f.store.listVersions(tool.id).map(v=>v.version),[3,2,1]);
  assert.deepEqual(f.store.listVersions(tool.id).find(v=>v.version===1).config,{prefix:'原资料'});
  assert.ok(outputs.every(file=>fs.existsSync(file))); // Tool rollback is not filesystem undo.
  assert.equal(f.optimizer.getState().rollbacks.length,0);
});

test('closing an in-flight custom optimization cancels its job and retains stable source and grants',async t=>{
  let rejectJob;
  const canceled=[];
  const engine={generate:()=>new Promise((_,reject)=>{rejectJob=reject;}),cancel:id=>{canceled.push(id);rejectJob(Object.assign(Error('cancelled fixture'),{code:'CANCELLED'}));}};
  const f=session(t,{engine});
  const tool=f.store.saveTool({title:'稳定工具',kind:'custom',config:{},bundle:{title:'稳定工具',description:'测试',html:'<p>原界面</p>',css:'',js:'',permissions:[],inputHint:''}});
  f.store.saveSettings({grants:{[`${tool.id}:1`]:[]}});
  const pending=f.optimizer.propose({toolId:tool.id,request:'减少一步'});
  const rejection=assert.rejects(pending,{code:'CANCELLED'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.optimizer.getState().candidates[0].status,'running');
  await f.optimizer.close();await rejection;
  assert.equal(canceled.length,1);
  assert.equal(f.optimizer.getState().candidates[0].status,'interrupted');
  assert.equal(f.store.listVersions(tool.id).length,1);
  assert.deepEqual(f.store.listTools()[0].bundle,tool.bundle);
  assert.deepEqual(f.store.getSettings().grants,{[`${tool.id}:1`]:[]});
});
