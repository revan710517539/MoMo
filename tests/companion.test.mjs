import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createCompanion,parseReminderTime}=require('../electron/companion.cjs');
const {createStore}=require('../electron/store.cjs');
const later=()=>new Promise(r=>setImmediate(r));
function fixture(t,{realWatch=false,notifyImpl}={}){
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'momo-companion-'))),store=createStore(path.join(directory,'data'));
 let milliseconds=Date.UTC(2026,9,21,2),active=true,idle=0,selected=null,frontmost={bundleId:'com.example.editor',name:'Editor'},frontmostCalls=0;
 const watchers=[],notifications=[],states=[],instances=[];
 const watch=(dir,options,callback)=>{const watcher=new EventEmitter();Object.assign(watcher,{dir,options,callback,closed:false,close(){this.closed=true;}});watchers.push(watcher);return watcher;};
 const make=(extra={})=>{const instance=createCompanion({store,getTools:()=>store.listTools(),emit:state=>states.push(state),notify:async payload=>{notifications.push(payload);return notifyImpl?.(payload);},getIdleSeconds:()=>idle,isActive:()=>active,now:()=>milliseconds,chooseDirectory:async()=>selected,getFrontmost:async()=>{frontmostCalls++;return frontmost;},...(realWatch?{}:{watchDirectory:watch}),...extra});instances.push(instance);return instance;};
 t.after(()=>{for(const instance of instances)instance.stop();store.close();fs.rmSync(directory,{recursive:true,force:true});});
 const comp=make();return {directory,store,comp,make,watchers,notifications,states,advance:ms=>{milliseconds+=ms;},setTime:ms=>{milliseconds=ms;},now:()=>milliseconds,setActive:v=>{active=v;},setIdle:v=>{idle=v;},select:v=>{selected=v;},setFrontmost:v=>{frontmost=v;},get frontmostCalls(){return frontmostCalls;},tool:kind=>store.saveTool({title:`test-${kind}`,kind,config:{}})};
}

test('observation is default-off and manual memory distinguishes facts from inferences across restart',async t=>{
 const f=fixture(t),tool=f.tool('compare');f.comp.start();f.comp.recordUsage({toolId:tool.id,kind:'compare',config:{customer:'must-not-save'}});await f.comp.tick();
 let state=f.comp.getState();assert.equal(state.settings.observation.inApp,false);assert.equal(state.settings.observation.directories,false);assert.equal(state.settings.observation.frontmost,false);assert.equal(state.observations.counts.usage,0);assert.equal(f.frontmostCalls,0);assert.equal(f.notifications.length,0);
 state=f.comp.saveMemory({text:'用户确认的工作偏好',kind:'fact'});const fact=state.memories[0];state=f.comp.saveMemory({text:'可能偏好周五整理',kind:'inference',source:'用户待确认'});assert.equal(state.memories[0].kind,'inference');
 f.comp.saveMemory({id:fact.id,text:'用户修正后的偏好',kind:'fact'});f.comp.stop();const reopened=f.make();assert.equal(reopened.getState().memories.find(m=>m.id===fact.id).text,'用户修正后的偏好');reopened.deleteMemory({id:fact.id});assert.equal(reopened.getState().memories.length,1);assert.equal(JSON.stringify(f.store.getSettings()).includes('must-not-save'),false);
});

test('Chinese time parser uses Shanghai time and never silently chooses ambiguous times',()=>{
 const now=Date.UTC(2026,9,21,2);
 assert.equal(parseReminderTime('明天下午三点半',now).dueAt,'2026-10-22T07:30:00.000Z');assert.equal(parseReminderTime('十分钟后',now).dueAt,'2026-10-21T02:10:00.000Z');assert.equal(parseReminderTime('半小时后',now).dueAt,'2026-10-21T02:30:00.000Z');assert.equal(parseReminderTime('今天15:00',now).dueAt,'2026-10-21T07:00:00.000Z');
 for(const phrase of ['明天下午','明天三点','今天上午12点','明天晚上1点','下周有空','今天8:00','2026-02-30T10:00'])assert.equal(parseReminderTime(phrase,now).needsTimeConfirmation,true,phrase);
 assert.equal(parseReminderTime('明天下午',now).candidates.length,1);
});

test('ambiguous todo is not saved until an explicit time is confirmed',t=>{
 const f=fixture(t);const proposal=f.comp.saveTodo({title:'检查结果',timeText:'明天下午'});assert.equal(proposal.needsTimeConfirmation,true);assert.equal(f.comp.getState().todos.length,0);
 const state=f.comp.saveTodo({title:'检查结果',dueAt:proposal.candidates[0].dueAt,confirmedTime:true});assert.equal(state.todos.length,1);assert.equal(state.todos[0].dueAt,'2026-10-22T07:00:00.000Z');
 assert.throws(()=>f.comp.saveTodo({title:'无效确认',dueAt:'2026-10-20T00:00:00Z',confirmedTime:'yes'}),{code:'COMPANION_INVALID_INPUT'});
});

test('todo reminders survive restart without duplication and explicit snooze creates a new reminder',async t=>{
 const f=fixture(t);let state=f.comp.saveTodo({title:'核对完成结果',timeText:'一分钟后'}),id=state.todos[0].id;f.comp.start();await f.comp.tick();f.advance(60000);await f.comp.tick();await f.comp.tick();assert.equal(f.notifications.length,1);assert.equal(f.comp.getState().todos[0].delivery,'sent');
 f.comp.stop();const reopened=f.make();reopened.start();await reopened.tick();assert.equal(f.notifications.length,1);reopened.saveTodo({id,snoozeMinutes:10});f.advance(600000);await reopened.tick();assert.equal(f.notifications.length,2);reopened.saveTodo({id,done:true,snoozeMinutes:1});assert.equal(reopened.getState().todos[0].done,false);reopened.saveTodo({id,done:true});f.advance(60000);await reopened.tick();assert.equal(f.notifications.length,2);
});

test('failed notification is claimed before delivery and is not retried automatically after restart',async t=>{
 const f=fixture(t,{notifyImpl:()=>{throw Error('OS unavailable');}});f.comp.saveTodo({title:'本机提醒',timeText:'一分钟后'});f.comp.start();f.advance(60000);await f.comp.tick();assert.equal(f.notifications.length,1);assert.equal(f.comp.getState().todos[0].delivery,'failed');f.comp.stop();const reopened=f.make();reopened.start();await reopened.tick();assert.equal(f.notifications.length,1);
});

test('parallel ticks claim a due todo once and inactive or stopped sessions never notify',async t=>{
 let finish;const held=new Promise(r=>finish=r);const f=fixture(t,{notifyImpl:()=>held});f.comp.saveTodo({title:'到期提醒',timeText:'一分钟后'});f.comp.start();f.advance(60000);
 const a=f.comp.tick(),b=f.comp.tick();assert.equal(a,b);await later();assert.equal(f.notifications.length,1);assert.equal(f.store.getSettings().companion.todos[0].delivery,'pending');finish();await a;
 f.comp.saveTodo({title:'未登录时不提醒',timeText:'一分钟后'});f.setActive(false);f.advance(60000);await f.comp.tick();assert.equal(f.notifications.length,1);f.comp.stop();f.setActive(true);await f.comp.tick();assert.equal(f.notifications.length,1);
});

test('stop cancels a pending notification wait without allowing the scheduler to stay blocked',async t=>{
 let finish;const held=new Promise(r=>finish=r),f=fixture(t,{notifyImpl:()=>held});f.comp.saveTodo({title:'提醒调用可取消',timeText:'一分钟后'});f.comp.start();f.advance(60000);const pending=f.comp.tick();await later();f.comp.stop();await pending;assert.equal(f.notifications[0].signal.aborted,true);assert.equal(f.comp.getState().runtime.running,false);finish();
});

test('break timer excludes idle, lock, sleep, clock reversal and the actual rest interval',async t=>{
 const f=fixture(t);f.comp.updateSettings({breaks:{enabled:true,workMinutes:1,restMinutes:1},suggestions:{enabled:false}});f.comp.start();await f.comp.tick();
 f.setIdle(100);f.advance(15000);await f.comp.tick();assert.equal(f.comp.getState().runtime.breakActiveSeconds,0);
 f.setIdle(0);f.setActive(false);f.advance(15000);await f.comp.tick();f.setActive(true);f.advance(15000);await f.comp.tick();assert.equal(f.comp.getState().runtime.breakActiveSeconds,0);
 f.advance(300000);await f.comp.tick();assert.equal(f.comp.getState().runtime.breakActiveSeconds,0);f.advance(-30000);await f.comp.tick();assert.equal(f.comp.getState().runtime.breakActiveSeconds,0);
 for(let i=0;i<4;i++){f.advance(15000);await f.comp.tick();}assert.equal(f.comp.getState().runtime.breakActiveSeconds,60);assert.equal(f.notifications.filter(n=>n.kind==='break').length,1);
 const suggestion=f.comp.getState().suggestions.find(s=>s.kind==='break');const accepted=f.comp.suggestionAction({id:suggestion.id,action:'accept'});assert.equal(accepted.intent.type,'rest');await f.comp.tick();for(let i=0;i<4;i++){f.advance(15000);await f.comp.tick();}assert.equal(f.comp.getState().runtime.breakActiveSeconds,0);
 for(let i=0;i<4;i++){f.advance(15000);await f.comp.tick();}assert.equal(f.notifications.filter(n=>n.kind==='break').length,2);
});

test('usage suggestions require real allowed usage, respect dismiss cooldown, and never save input config',t=>{
 const f=fixture(t),tool=f.tool('compare');f.comp.updateSettings({observation:{inApp:true},suggestions:{cooldownMinutes:1}});f.comp.start();for(let i=0;i<3;i++)f.comp.recordUsage({toolId:tool.id,kind:'compare',config:{raw:'private-input-must-not-save'}});
 let state=f.comp.getState();assert.equal(state.suggestions.length,1);const id=state.suggestions[0].id;assert.equal(state.suggestions[0].evidence.count,3);assert.equal(JSON.stringify(f.store.getSettings()).includes('private-input-must-not-save'),false);
 f.comp.suggestionAction({id,action:'dismiss'});f.comp.recordUsage({toolId:tool.id});assert.equal(f.comp.getState().suggestions.length,1);f.advance(120001);for(let i=0;i<3;i++)f.comp.recordUsage({toolId:tool.id});state=f.comp.getState();const pending=state.suggestions.find(s=>s.status==='pending');assert.ok(pending);assert.equal(f.comp.suggestionAction({id:pending.id,action:'accept'}).intent.toolId,tool.id);
 const count=state.observations.counts.usage;f.comp.updateSettings({observation:{inApp:false}});f.comp.recordUsage({toolId:tool.id});assert.equal(f.comp.getState().observations.counts.usage,count);
});

test('directory metadata observation requires selection, excludes sensitive names, debounces, removes authorization and handles deletion',async t=>{
 const f=fixture(t),selected=path.join(f.directory,'selected-work');fs.mkdirSync(selected);f.select({canceled:false,filePaths:[selected]});f.comp.start();await f.comp.chooseObservationDirectory();assert.equal(f.watchers.length,0);f.comp.updateSettings({observation:{directories:true},suggestions:{fileChangeThreshold:2}});assert.equal(f.watchers.length,1);
 const watcher=f.watchers[0];for(const filename of ['.env','node_modules','private.pem','nested/file.csv',null])watcher.callback('change',filename);f.advance(800);await f.comp.tick();assert.equal(f.comp.getState().observations.counts.directoryEvents,0);
 watcher.callback('change','never-collect-this-name.csv');watcher.callback('rename','another-private-name.csv');f.advance(800);await f.comp.tick();let state=f.comp.getState();assert.equal(state.observations.counts.directoryEvents,2);assert.equal(state.suggestions[0].intent.type,'create-tool');assert.equal(JSON.stringify(state).includes(selected),false);assert.equal(JSON.stringify(f.store.getSettings()).includes('never-collect-this-name'),false);
 fs.rmSync(selected,{recursive:true});await f.comp.tick();assert.equal(watcher.closed,true);assert.ok(f.comp.getState().observations.directories[0].error);
 const id=state.observations.directories[0].id;f.comp.removeObservationDirectory({id});watcher.callback('change','late.csv');f.advance(1000);await f.comp.tick();state=f.comp.getState();assert.equal(state.observations.directories.length,0);assert.equal(state.suggestions.length,0);assert.equal(JSON.stringify(f.store.getSettings()).includes(selected),false);
});

test('turning directory observation off closes watchers and ignores late callbacks; restart reattaches only while explicitly enabled',async t=>{
 const f=fixture(t),directory=path.join(f.directory,'watch');fs.mkdirSync(directory);f.select(directory);f.comp.start();await f.comp.chooseObservationDirectory();f.comp.updateSettings({observation:{directories:true}});const old=f.watchers[0];f.comp.updateSettings({observation:{directories:false}});assert.equal(old.closed,true);old.callback('change','late.csv');f.advance(1000);await f.comp.tick();assert.equal(f.comp.getState().observations.counts.directoryEvents,0);
 f.comp.stop();const reopened=f.make();reopened.start();assert.equal(f.watchers.length,1);reopened.updateSettings({observation:{directories:true}});assert.equal(f.watchers.length,2);assert.equal(f.watchers[1].options.recursive,false);
});

test('frontmost app records only name/bundle metadata, excludes configured apps and pauses for one hour',async t=>{
 const f=fixture(t);f.comp.updateSettings({observation:{frontmost:true}});f.comp.start();f.setFrontmost({bundleId:'com.example.editor',name:'Editor',windowTitle:'do-not-store-window-title',documentPath:'/private/customer.csv'});await f.comp.tick();assert.equal(f.frontmostCalls,1);assert.equal(f.comp.getState().observations.apps.length,1);assert.equal(JSON.stringify(f.store.getSettings()).includes('do-not-store-window-title'),false);
 f.setFrontmost({bundleId:'com.1password.1password',name:'1Password'});await f.comp.tick();assert.equal(f.comp.getState().observations.frontmost,null);assert.equal(f.comp.getState().observations.apps.length,1);
 f.comp.updateSettings({observation:{excludedApps:['Editor']}});assert.equal(f.comp.getState().observations.apps.length,0);f.comp.updateSettings({pauseMinutes:60});const before=f.frontmostCalls;await f.comp.tick();assert.equal(f.frontmostCalls,before);f.advance(3600001);await f.comp.tick();assert.equal(f.frontmostCalls,before+1);assert.equal(f.comp.getState().settings.pausedUntil,null);
});

test('three observed returns to Excel suggest an existing compare tool once, without asserting content or saving a habit',async t=>{
 const f=fixture(t),tool=f.tool('compare'),excel={bundleId:'com.microsoft.Excel',name:'Microsoft Excel'},other={bundleId:'com.apple.Notes',name:'Notes'};
 f.comp.updateSettings({observation:{frontmost:true}});f.comp.start();
 for(let i=0;i<3;i++){f.setFrontmost(other);await f.comp.tick();f.setFrontmost(excel);await f.comp.tick();if(i<2)assert.equal(f.comp.getState().suggestions.length,0);}
 let state=f.comp.getState(),suggestion=state.suggestions[0];assert.equal(state.suggestions.length,1);assert.equal(suggestion.kind,'app');assert.equal(suggestion.evidence.count,3);assert.equal(suggestion.intent.toolId,tool.id);assert.match(suggestion.reason,/只是应用切换线索/);assert.match(suggestion.reason,/未读取表格内容/);assert.equal(state.memories.length,0);
 await f.comp.tick();assert.equal(f.comp.getState().observations.apps.find(a=>a.bundleId===excel.bundleId).count,3);
 f.setFrontmost(other);await f.comp.tick();f.setFrontmost(excel);await f.comp.tick();assert.equal(f.comp.getState().suggestions.length,1);
 f.comp.suggestionAction({id:suggestion.id,action:'dismiss'});f.setFrontmost(other);await f.comp.tick();f.setFrontmost(excel);await f.comp.tick();assert.equal(f.comp.getState().suggestions.length,1);
 f.comp.updateSettings({observation:{excludedApps:['com.microsoft.Excel']}});assert.equal(f.comp.getState().suggestions.length,0);assert.equal(f.comp.getState().observations.apps.some(a=>a.bundleId===excel.bundleId),false);
});

test('excluded spreadsheets and spreadsheet use without a compatible compare tool produce no app suggestion',async t=>{
 const f=fixture(t),other={bundleId:'com.apple.Notes',name:'Notes'},excel={bundleId:'com.microsoft.Excel',name:'Microsoft Excel'},numbers={bundleId:'com.apple.iWork.Numbers',name:'Numbers'};
 f.tool('rename');f.comp.updateSettings({observation:{frontmost:true,excludedApps:['Microsoft Excel']}});f.comp.start();
 for(let i=0;i<4;i++){f.setFrontmost(other);await f.comp.tick();f.setFrontmost(excel);await f.comp.tick();f.setFrontmost(other);await f.comp.tick();f.setFrontmost(numbers);await f.comp.tick();}
 assert.equal(f.comp.getState().suggestions.length,0);assert.equal(f.comp.getState().observations.apps.some(a=>a.bundleId===excel.bundleId),false);
 const tool=f.tool('compare');f.setFrontmost(other);await f.comp.tick();f.setFrontmost(numbers);await f.comp.tick();assert.equal(f.comp.getState().suggestions[0].intent.toolId,tool.id);
});

test('spreadsheet coach rule uses a bounded 24-hour switch window rather than stale cumulative counts',async t=>{
 const f=fixture(t),excel={bundleId:'com.microsoft.Excel',name:'Microsoft Excel'},other={bundleId:'com.apple.Notes',name:'Notes'};f.tool('compare');f.comp.updateSettings({observation:{frontmost:true}});f.comp.start();
 const cycle=async()=>{f.setFrontmost(other);await f.comp.tick();f.setFrontmost(excel);await f.comp.tick();};await cycle();await cycle();f.advance(25*3600000);await cycle();assert.equal(f.comp.getState().suggestions.length,0);await cycle();await cycle();assert.equal(f.comp.getState().suggestions[0].evidence.count,3);assert.equal(f.comp.getState().observations.apps.find(a=>a.bundleId===excel.bundleId).recentSwitches.length,3);
});

test('pausing observation keeps explicit todo and break reminders active without collecting new events',async t=>{
 const f=fixture(t),tool=f.tool('compare');f.comp.updateSettings({observation:{inApp:true,frontmost:true},breaks:{enabled:true,workMinutes:1}});f.comp.start();await f.comp.tick();const before=f.frontmostCalls;
 f.comp.saveTodo({title:'观察暂停时仍需提醒',timeText:'一分钟后'});f.comp.updateSettings({pauseMinutes:60});await f.comp.tick();
 for(let i=0;i<4;i++){f.comp.recordUsage({toolId:tool.id});f.advance(15000);await f.comp.tick();}
 const state=f.comp.getState();assert.equal(state.runtime.observing,false);assert.equal(state.runtime.active,true);assert.equal(state.observations.counts.usage,0);assert.equal(f.frontmostCalls,before);assert.equal(f.notifications.filter(n=>n.kind==='todo').length,1);assert.equal(f.notifications.filter(n=>n.kind==='break').length,1);
});

test('using confirmed memories in generation is explicit, default-off and persisted as a boolean',t=>{
 const f=fixture(t);assert.equal(f.comp.getState().settings.useConfirmedMemoryForGeneration,false);f.comp.saveMemory({text:'待确认，不自动发送',kind:'inference'});assert.equal(f.comp.getState().settings.useConfirmedMemoryForGeneration,false);
 assert.throws(()=>f.comp.updateSettings({useConfirmedMemoryForGeneration:'true'}),{code:'COMPANION_INVALID_INPUT'});f.comp.updateSettings({useConfirmedMemoryForGeneration:true});f.comp.stop();const reopened=f.make();assert.equal(reopened.getState().settings.useConfirmedMemoryForGeneration,true);reopened.updateSettings({useConfirmedMemoryForGeneration:false});assert.equal(f.store.getSettings().companion.settings.useConfirmedMemoryForGeneration,false);
});

test('stop invalidates and aborts a pending frontmost query and does not record its late result',async t=>{
 let resolve,signal;const pending=new Promise(r=>resolve=r);const f=fixture(t);const comp=f.make({getFrontmost:options=>{signal=options.signal;return pending;}});comp.updateSettings({observation:{frontmost:true}});comp.start();const tick=comp.tick();await later();comp.stop();await tick;assert.equal(signal.aborted,true);resolve({bundleId:'late.app',name:'Late'});await later();assert.equal(comp.getState().observations.apps.length,0);
});

test('unavailable app observation reports a safe visible error without exposing helper paths',async t=>{
 const f=fixture(t),comp=f.make({getFrontmost:()=>{throw Error('/private/customer/helper-path');}});comp.updateSettings({observation:{frontmost:true}});comp.start();await comp.tick();const state=comp.getState();assert.ok(state.observations.frontmostError);assert.equal(state.runtime.frontmostAvailable,false);assert.equal(state.observations.frontmost,null);assert.equal(JSON.stringify(state).includes('/private/customer'),false);
});

test('forgetting observations removes authorization/history but preserves user memories and todos; audit stays bounded',async t=>{
 const f=fixture(t),tool=f.tool('compare'),directory=path.join(f.directory,'remembered-dir');fs.mkdirSync(directory);f.select(directory);f.comp.start();await f.comp.chooseObservationDirectory();f.comp.updateSettings({observation:{inApp:true,directories:true}});for(let i=0;i<130;i++)f.comp.recordUsage({toolId:tool.id});f.comp.saveMemory({text:'保留的用户事实',kind:'fact'});f.comp.saveTodo({title:'保留的待办'});assert.equal(f.comp.getState().audit.length,100);
 const state=f.comp.forgetObservations();assert.equal(state.memories.length,1);assert.equal(state.todos.length,1);assert.equal(state.observations.counts.usage,0);assert.equal(state.observations.directories.length,0);assert.equal(state.settings.observation.inApp,false);assert.equal(state.audit.length,1);assert.equal(JSON.stringify(f.store.getSettings()).includes(directory),false);
});

test('invalid persisted observation flags fail closed instead of silently enabling watchers',t=>{
 const f=fixture(t);f.comp.saveMemory({text:'保留记录'});const persisted=f.store.getSettings().companion;persisted.settings.observation.frontmost='yes';f.store.saveSettings({companion:persisted});assert.throws(()=>f.make(),{code:'COMPANION_STORAGE_CORRUPT'});assert.equal(f.frontmostCalls,0);
});

test('unchanged low-frequency ticks do not repeatedly rewrite the settings database',async t=>{
 const f=fixture(t),original=f.store.saveSettings;let writes=0;f.store.saveSettings=patch=>{writes++;return original(patch);};f.comp.start();await f.comp.tick();f.advance(15000);await f.comp.tick();assert.equal(writes,0);f.comp.saveMemory({text:'明确保存一次'});assert.equal(writes,1);f.advance(15000);await f.comp.tick();assert.equal(writes,1);
});

test('real fs.watch metadata produces a bounded count without reading or retaining file content',async t=>{
 const f=fixture(t,{realWatch:true}),directory=path.join(f.directory,'real-watch');fs.mkdirSync(directory);f.select(directory);f.comp.start();await f.comp.chooseObservationDirectory();f.comp.updateSettings({observation:{directories:true}});
 const file=path.join(directory,'private-report.csv');fs.writeFileSync(file,'private-file-content-never-read');
 const deadline=Date.now()+5000;let retry=0;while(f.comp.getState().observations.counts.directoryEvents===0&&Date.now()<deadline){await new Promise(r=>setTimeout(r,50));if(++retry%5===0)fs.appendFileSync(file,'\nfixture-change');}
 assert.ok(f.comp.getState().observations.counts.directoryEvents>0);assert.equal(JSON.stringify(f.store.getSettings()).includes('private-report.csv'),false);assert.equal(JSON.stringify(f.store.getSettings()).includes('private-file-content-never-read'),false);f.comp.stop();
});
