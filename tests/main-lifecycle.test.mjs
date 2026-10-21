import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {validateBundle}=require('../electron/opencode.cjs');
const source=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
const bundle=()=>({title:'计数工具',description:'仅本地测试',html:'<output>0</output>',css:'',js:'',permissions:[],inputHint:'输入'});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture({fetchImpl,authenticated=true,initialPet}={}){
 const tools=new Map(),tasks=new Map(),operations=new Map(),settings={initialized:true,...(initialPet?{pet:initialPet}:{})},handlers=new Map(),windows=[];
 let dbClosed=false,engine,calls=[],exitCode,capabilityCreations=0,companion,optimizer,petController;
 const lifecycle=[];
 const copy=value=>structuredClone(value);
 const store={
  listTools:()=>[...tools.values()].map(copy),listTasks:()=>[...tasks.values()].map(copy),getSettings:()=>copy(settings),
  saveSettings:patch=>Object.assign(settings,copy(patch)),
  saveTask:task=>{assert.equal(dbClosed,false,'task written after store.close');const saved={...tasks.get(task.id),...copy(task)};tasks.set(task.id,saved);return copy(saved);},
  saveTool:tool=>{assert.equal(dbClosed,false,'tool written after store.close');const id=tool.id||`tool-${tools.size+1}`,old=tools.get(id);const saved={...copy(tool),id,version:(old?.version||0)+1};tools.set(id,saved);return copy(saved);},
  getOperation:id=>copy(operations.get(id)),close:()=>{dbClosed=true;},
 };
 class Window extends EventEmitter{
  constructor(){super();const wc=new EventEmitter();wc.id=windows.length+1;wc.mainFrame={};wc.sent=[];wc.send=(channel,payload)=>wc.sent.push({channel,payload});wc.setWindowOpenHandler=()=>{};wc.session={setPermissionRequestHandler:()=>{}};this.webContents=wc;windows.push(this);}
  isDestroyed(){return false;}isMinimized(){return false;}restore(){}loadFile(){}show(){}hide(){}focus(){}showInactive(){}
 }
 const app=new EventEmitter();Object.assign(app,{setName:()=>{},getName:()=> 'Momo test',getVersion:()=> '0.1.0',getPath:()=> '/tmp/momo-main-test',getAppPath:()=>process.cwd(),requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),quit:()=>{},exit:code=>{exitCode=code;},isPackaged:false});
 const capabilities={};for(const name of ['pickFiles','readFile','saveText','planRename','executeRename','undoOperation','openOutput','notify','readClipboard','writeClipboard'])capabilities[name]=async args=>{calls.push({name,args});return {canceled:false};};
 class Engine{
  constructor(options){this.options=options;this.generateCalls=[];this.cancelCalls=[];this.generateImpl=async()=>bundle();this.closeImpl=async()=>{};engine=this;}
  status(){return {installed:true,configured:false,version:'1.19.3'};}
  generate(args){this.generateCalls.push(args);return this.generateImpl(args);}
  cancel(id){this.cancelCalls.push(id);return true;}
  close(){return this.closeImpl();}
 }
 const powerMonitor=new EventEmitter();powerMonitor.getSystemIdleTime=()=>0;
 const electron={app,BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showMessageBox:async()=>({response:1})},shell:{},clipboard:{},Notification:class{},safeStorage:{decryptString:()=> 'fixture-key',isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s)},session:{defaultSession:{webRequest:{onBeforeRequest:()=>{}}}},nativeImage:{},powerMonitor,screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1500,height:1000}})}};
 const authMock={getSession:()=>({authenticated,user:authenticated?{username:'tester',displayName:'测试'}:null}),status:async()=>({setupRequired:false,...authMock.getSession()}),login:async()=>{authenticated=true;return authMock.getSession();},register:async()=>{authenticated=true;return authMock.getSession();},logout:()=>{authenticated=false;return authMock.getSession();}};
 function createCompanion(options){
  const state={settings:{observation:{inApp:false,directories:false,frontmost:false},paused:false},memories:[],todos:[],suggestions:[]};let running=false;const records=[];
  companion={options,records,getState:()=>({...copy(state),runtime:{running,active:running&&options.isActive()&&!state.settings.paused,paused:state.settings.paused}}),start:()=>{running=true;lifecycle.push('companion:start');return companion.getState();},stop:()=>{running=false;lifecycle.push('companion:stop');return companion.getState();},updateSettings:patch=>{Object.assign(state.settings,{...patch,observation:{...state.settings.observation,...patch.observation}});if(Object.hasOwn(patch,'pauseMinutes'))state.settings.paused=patch.pauseMinutes>0;return companion.getState();},recordUsage:record=>{records.push(copy(record));return companion.getState();},suggestionAction:()=>({state:companion.getState()}),forgetObservations:()=>companion.getState()};
  for(const method of ['saveMemory','deleteMemory','saveTodo','deleteTodo','chooseObservationDirectory','removeObservationDirectory'])companion[method]=()=>companion.getState();return companion;
 }
 function createOptimizer(options){
  const state={candidates:[],rollbacks:[],observations:{}};const autoCalls=[],proposeCalls=[],forgot=[];
  optimizer={options,autoCalls,proposeCalls,forgot,getState:()=>copy(state),closeImpl:async()=>{},close:()=>{lifecycle.push('optimizer:close');return optimizer.closeImpl();},propose:async p=>{proposeCalls.push(copy(p));if(!options.canRun())throw Object.assign(Error('not allowed'),{code:'NOT_ALLOWED'});return {id:'optimizer:test',...p};},markTrial:async p=>p,dismiss:async p=>p,apply:async p=>({candidate:p,tool:store.listTools()[0]}),rollback:async({toolId})=>store.listTools().find(t=>t.id===toolId),forgetUsage:async p=>{forgot.push(p);state.observations={};return optimizer.getState();},autoOptimizeUsage:async p=>{autoCalls.push(copy(p));return optimizer.autoImpl(p);},autoImpl:async()=>({observed:true,count:autoCalls.length})};return optimizer;
 }
 function createPetController(options){petController={options,start:()=>lifecycle.push('pet:start'),stop:()=>lifecycle.push('pet:stop'),dispose:()=>lifecycle.push('pet:dispose'),interaction:input=>({paused:!!input.hover}),fold:async()=>({folded:true}),unfold:async()=>{lifecycle.push('pet:unfold');return {folded:false};},transitionReady:input=>{lifecycle.push('pet:transition-ready');return {accepted:!!input?.transitionId};}};return petController;}
 const customRequire=id=>id==='./auth.cjs'?{createAuth:()=>authMock}:id==='electron'?electron:id==='./store.cjs'?{createStore:()=>store}:id==='./companion.cjs'?{createCompanion}:id==='./optimizer.cjs'?{createOptimizer}:id==='./pet-controller.cjs'?{createPetController}:id==='./capabilities.cjs'?{createCapabilities:()=>{capabilityCreations++;return capabilities;}}:id==='./opencode.cjs'?{OpenCodeEngine:Engine,validateBundle}:require(id);
 vm.runInNewContext(source,{require:customRequire,__dirname:path.resolve('electron'),process:{platform:process.platform,arch:process.arch,env:{}},Buffer,Promise,URL,fetch:fetchImpl||(()=>{throw Error('Network forbidden in fixture');}),AbortSignal,AbortController,console},{filename:'electron/main.cjs'});
 await tick();
 const event={sender:windows[0].webContents,senderFrame:windows[0].webContents.mainFrame};
 return {app,engine,store,tools,tasks,operations,settings,capabilities,calls,windows,authMock,companion,optimizer,petController,powerMonitor,lifecycle,dialog:electron.dialog,get capabilityCreations(){return capabilityCreations;},call:(name,payload)=>handlers.get(`momo:${name}`)(event,payload),raw:(name)=>handlers.get(`momo:${name}`),event,get dbClosed(){return dbClosed;},get exitCode(){return exitCode;}};
}

test('main enforces adapter request limit and protects active and historical task IDs',async()=>{
 const f=await fixture();let response=await f.call('generate',{id:'too-big',request:'x'.repeat(12001)});
 assert.equal(response.code,'INVALID_REQUEST');assert.equal(f.tasks.size,0);
 const d=deferred();f.engine.generateImpl=()=>d.promise;
 const original=f.call('generate',{id:'same',request:'做工具'});await tick();
 response=await f.call('generate',{id:'same',request:'重复'});assert.equal(response.code,'INVALID_REQUEST');assert.equal(f.tasks.get('same').status,'running');assert.equal(f.engine.generateCalls.length,1);
 d.resolve(bundle());await original;
 response=await f.call('generate',{id:'same',request:'重用'});assert.equal(response.code,'INVALID_REQUEST');assert.equal(f.tasks.get('same').status,'completed');
});

test('generation persists validated source, revision contract and stable task timestamps',async()=>{
 const f=await fixture(),initial=f.store.saveTool({title:'旧工具',kind:'custom',bundle:bundle(),config:{color:'green'}});
 const d=deferred();f.engine.generateImpl=()=>d.promise;
 const pending=f.call('generate',{id:'revision',request:'改字号',toolId:initial.id});await tick();const started=f.tasks.get('revision').createdAt;
 assert.deepEqual(f.engine.generateCalls[0].previous,initial.bundle);
 d.resolve({...bundle(),title:'新工具'});const saved=await pending;
 assert.equal(saved.id,initial.id);assert.equal(saved.version,2);assert.equal(saved.title,'新工具');assert.equal(saved.config.color,'green');assert.equal(f.tasks.get('revision').status,'completed');assert.equal(f.tasks.get('revision').createdAt,started);
});

test('late engine success after cancellation never saves and cancellation reports missing jobs',async()=>{
 const f=await fixture(),d=deferred();f.engine.generateImpl=()=>d.promise;
 const pending=f.call('generate',{id:'cancel',request:'做工具'});await tick();
 assert.equal((await f.call('cancelGeneration',{id:'missing'})).cancelled,false);
 assert.equal((await f.call('cancelGeneration',{id:'cancel'})).cancelled,true);assert.deepEqual(f.engine.cancelCalls,['cancel']);
 d.resolve(bundle());const response=await pending;assert.equal(response.code,'CANCELLED');assert.equal(f.tools.size,0);assert.equal(f.tasks.get('cancel').status,'cancelled');
});

test('timeout and engine configuration errors become failed tasks with their error codes',async()=>{
 const f=await fixture();for(const code of ['TIMEOUT','NOT_CONFIGURED','OPENCODE_ERROR']){
 f.engine.generateImpl=async()=>{throw Object.assign(Error('安全错误提示'),{code});};const response=await f.call('generate',{id:code,request:'做工具'});assert.equal(response.code,code);assert.equal(f.tasks.get(code).status,'failed');assert.equal(f.tools.size,0);}
 f.engine.generateImpl=async()=>({...bundle(),js:'require("fs")'});const invalid=await f.call('generate',{id:'unsafe',request:'做工具'});assert.equal(invalid.code,'INVALID_BUNDLE');assert.equal(f.tools.size,0);
});

test('concurrent edits and archives prevent generated revision from overwriting current state',async()=>{
 const f=await fixture();for(const archive of [false,true]){
 const old=f.store.saveTool({id:`original-${archive}`,title:'原工具',kind:'custom',bundle:bundle()});const d=deferred();f.engine.generateImpl=()=>d.promise;
 const pending=f.call('generate',{id:`stale-${archive}`,request:'改样式',toolId:old.id});await tick();
 if(archive)f.tools.delete(old.id);else f.store.saveTool({...old,title:'用户刚保存的新版本'});
 d.resolve(bundle());const response=await pending;assert.equal(response.code,'STALE_TOOL');assert.equal(f.tasks.get(`stale-${archive}`).status,'failed');
 if(archive)assert.equal(f.tools.has(old.id),false);else assert.equal(f.tools.get(old.id).title,'用户刚保存的新版本');}
});

test('repeated quit waits for engine and main task finalization before closing the store',async()=>{
 const f=await fixture(),generation=deferred(),shutdown=deferred();f.engine.generateImpl=()=>generation.promise;f.engine.closeImpl=()=>shutdown.promise;
 const pending=f.call('generate',{id:'quit',request:'做工具'});await tick();
 let prevented=0;f.app.emit('before-quit',{preventDefault:()=>prevented++});f.app.emit('before-quit',{preventDefault:()=>prevented++});await tick();
 assert.equal(prevented,2);assert.equal(f.dbClosed,false);assert.equal(f.exitCode,undefined);
 assert.equal((await f.call('generate',{id:'new',request:'不应启动'})).code,'CLOSED');
 shutdown.resolve();await tick();assert.equal(f.dbClosed,false);
 generation.reject(Object.assign(Error('制作已取消'),{code:'CANCELLED'}));await pending;await tick();
 assert.equal(f.tasks.get('quit').status,'cancelled');assert.equal(f.dbClosed,true);assert.equal(f.exitCode,0);
});

test('native operations record running before execution and preserve recoverable failure receipts',async()=>{
 const f=await fixture(),d=deferred();f.capabilities.executeRename=()=>{assert.ok([...f.tasks.values()].some(t=>t.action==='executeRename'&&t.status==='running'));return d.promise;};
 f.operations.set('rename-receipt',{id:'rename-receipt',type:'rename',status:'rollback_failed'});
 const pending=f.call('executeRename',{planId:'plan'});await tick();d.reject(Object.assign(Error('部分文件未恢复'),{operationId:'rename-receipt'}));const response=await pending;
 assert.equal(response.operationId,'rename-receipt');const task=[...f.tasks.values()][0];assert.equal(task.status,'failed');assert.equal(task.operationId,'rename-receipt');assert.equal(task.recoverable,true);
});

test('save and undo receipts cannot masquerade as completed rename recovery tasks',async()=>{
 const f=await fixture();f.capabilities.saveText=async()=>({id:'output',name:'out.txt',canceled:false});await f.call('saveText',{name:'out.txt',content:'a'});
 let task=[...f.tasks.values()].find(t=>t.action==='saveText');assert.equal(task.outputId,'output');assert.equal(task.operationId,undefined);assert.equal(task.recoverable,false);
 f.capabilities.undoOperation=async()=>({operationId:'undo-audit',undoneOperationId:'original',status:'completed'});await f.call('undoOperation',{operationId:'original'});
 task=[...f.tasks.values()].find(t=>t.action==='undoOperation');assert.equal(task.linkedOperationId,'original');assert.equal(task.undoAuditId,'undo-audit');assert.equal(task.operationId,undefined);
 f.capabilities.saveText=async()=>({canceled:true});await f.call('saveText',{});assert.ok([...f.tasks.values()].some(t=>t.action==='saveText'&&t.status==='cancelled'));
});

test('runtime IPC requires exact current version before native access or task creation',async()=>{
 const f=await fixture(),tool=f.store.saveTool({id:'runtime',kind:'custom',title:'剪贴板',bundle:{...bundle(),permissions:['clipboard.read']}});f.settings.grants={[`${tool.id}:${tool.version}`]:['clipboard.read']};
 for(const version of [undefined,0,'1']){const result=await f.call('runtimeInvoke',{toolId:tool.id,version,capability:'readClipboard'});assert.equal(result.code,'STALE_TOOL');}
 assert.equal(f.calls.length,0);assert.equal(f.tasks.size,0);
 f.capabilities.readClipboard=async()=>({text:'fixture'});const result=await f.call('runtimeInvoke',{toolId:tool.id,version:tool.version,capability:'readClipboard'});assert.equal(result.text,'fixture');assert.equal([...f.tasks.values()][0].status,'completed');
});

test('quit also waits for native operation receipts and rejects new native requests',async()=>{
 const f=await fixture(),d=deferred();f.capabilities.saveText=()=>d.promise;
 const pending=f.call('saveText',{name:'result.txt',content:'fixture'});await tick();
 f.app.emit('before-quit',{preventDefault:()=>{}});await tick();assert.equal(f.dbClosed,false);
 assert.equal((await f.call('executeRename',{planId:'new'})).code,'CLOSED');
 d.resolve({id:'output-id',canceled:false});await pending;await tick();
 assert.equal([...f.tasks.values()][0].status,'completed');assert.equal(f.dbClosed,true);
});

test('quit aborts a pending pet image request before finalizing its task and closing storage',async()=>{
 let receivedSignal;const f=await fixture({fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{receivedSignal=signal;signal.addEventListener('abort',()=>reject(Error('fixture aborted')),{once:true});})});
 Object.assign(f.settings,{baseURL:'https://example.invalid/v1',imageModel:'fixture-image',encryptedApiKey:'fixture-encrypted-key'});
 const pending=f.call('generatePet',{prompt:'一个小伙伴'});await tick();assert.equal(receivedSignal.aborted,false);
 f.app.emit('before-quit',{preventDefault:()=>{}});await pending;await tick();
 assert.equal(receivedSignal.aborted,true);assert.equal([...f.tasks.values()][0].status,'cancelled');assert.equal(f.dbClosed,true);
});

test('settings reject remote plaintext and URL credentials before saving encrypted keys',async()=>{
 const f=await fixture();
 for(const baseURL of ['http://example.com/v1','https://user:pass@example.com/v1','https://example.com/v1?key=fixture']){
  const response=await f.call('saveSettings',{baseURL,apiKey:'fixture-key'});assert.equal(response.ok,false);assert.equal(f.settings.encryptedApiKey,undefined);
 }
 const saved=await f.call('saveSettings',{baseURL:'https://example.com/v1',model:'fixture',apiKey:'fixture-key'});
 assert.equal(saved.hasApiKey,true);assert.equal(saved.apiKey,undefined);assert.equal(f.settings.apiKey,undefined);
 const cleared=await f.call('saveSettings',{clearApiKey:true});assert.equal(cleared.hasApiKey,false);
 const local=await f.call('saveSettings',{baseURL:'http://127.0.0.1:12345/v1'});assert.equal(local.baseURL,'http://127.0.0.1:12345/v1');
});

test('login gates native IPC before and after logout; public authentication keeps trusted-window boundary',async()=>{
 const f=await fixture({authenticated:false});
 for(const name of ['listTools','getSettings','readClipboard','pickFiles','runtimeInvoke','listTasks','getPetState'])assert.equal((await f.call(name,{})).code,'AUTH_REQUIRED');
 assert.equal((await f.call('authStatus')).authenticated,false);assert.equal(f.calls.length,0);
 const alien={sender:{id:999,mainFrame:{}},senderFrame:{}};assert.equal((await f.raw('authLogin')(alien,{})).ok,false);
 const session=await f.call('authLogin',{username:'tester',password:'fixture-only'});assert.equal(session.authenticated,true);assert.ok(Array.isArray(await f.call('listTools')));
 const d=deferred();f.capabilities.saveText=()=>d.promise;const pending=f.call('saveText',{name:'test.txt',content:'test'});await tick();
 assert.equal((await f.call('authLogout')).code,'AUTH_BUSY');d.resolve({id:'output',canceled:false});await pending;
 assert.equal((await f.call('authLogout')).authenticated,false);assert.equal(f.capabilityCreations,2);assert.equal((await f.call('listTools')).code,'AUTH_REQUIRED');assert.equal((await f.call('saveSettings',{})).code,'AUTH_REQUIRED');
});

test('pet navigation survives main-window recreation until React subscribes and signals readiness',async()=>{
 const f=await fixture({authenticated:false});await f.call('authLogin',{});await f.call('uiReady');
 const pet=f.windows[1];f.windows[0].emit('closed');
 const petEvent={sender:pet.webContents,senderFrame:pet.webContents.mainFrame};
 await f.raw('petAction')(petEvent,{action:'latest'});const current=f.windows.at(-1);
 const event={sender:current.webContents,senderFrame:current.webContents.mainFrame};
 assert.equal(current.webContents.sent.filter(v=>v.channel==='momo:pet-action').length,0);
 await f.raw('uiReady')(event,{});
 assert.deepEqual(current.webContents.sent.filter(v=>v.channel==='momo:pet-action').map(v=>v.payload.action),['latest']);
 await f.raw('uiReady')(event,{});assert.equal(current.webContents.sent.filter(v=>v.channel==='momo:pet-action').length,1);
 await f.raw('petAction')(petEvent,{action:'pets'});assert.equal(current.webContents.sent.at(-1).payload.action,'pets');
});

test('repeated and concurrent authentication cannot clear a live session or race task protection',async()=>{
 const f=await fixture();let calls=0;f.authMock.login=async()=>{calls++;throw Error('must not clear a live session');};
 assert.equal((await f.call('authLogin',{password:'wrong-fixture'})).authenticated,true);assert.equal(calls,0);assert.ok(Array.isArray(await f.call('listTools')));
 const loggedOut=await fixture({authenticated:false}),d=deferred();loggedOut.authMock.login=()=>d.promise;
 const first=loggedOut.call('authLogin',{password:'fixture'});await tick();
 assert.equal((await loggedOut.call('authLogin',{})).code,'AUTH_BUSY');assert.equal(loggedOut.raw('authRegister'),undefined);
 d.reject(Object.assign(Error('invalid'),{code:'AUTH_INVALID_CREDENTIALS'}));assert.equal((await first).code,'AUTH_INVALID_CREDENTIALS');assert.equal((await loggedOut.call('listTools')).code,'AUTH_REQUIRED');
});

test('companion and optimizer IPC retain authentication and exact main-frame boundaries',async()=>{
 const f=await fixture({authenticated:false});
 const methods=['getCompanionState','companionSettings','companionMemory','companionTodo','recordToolUsage','getOptimizerState','optimizerSettings','optimizerPropose','optimizerTrial','optimizerApply','optimizerRollback','optimizerDismiss','optimizerForgetUsage'];
 for(const name of methods){assert.equal((await f.call(name,{})).code,'AUTH_REQUIRED',name);const child={sender:f.event.sender,senderFrame:{}};assert.equal((await f.raw(name)(child,{})).ok,false,`${name} child frame`);}
 assert.equal(f.optimizer.proposeCalls.length,0);assert.equal(f.companion.records.length,0);
 await f.call('authLogin',{});assert.ok(f.lifecycle.includes('companion:start'));assert.ok(f.lifecycle.includes('pet:start'));
 const outsider={sender:{id:999,mainFrame:{}},senderFrame:null};outsider.senderFrame=outsider.sender.mainFrame;assert.equal((await f.raw('optimizerPropose')(outsider,{toolId:'anything'})).ok,false);
 assert.equal((await f.call('getOptimizerState')).autoOptimizeSettings,false);
 await f.call('authLogout');assert.equal((await f.call('companionSettings',{})).code,'AUTH_REQUIRED');assert.equal((await f.call('optimizerPropose',{})).code,'AUTH_REQUIRED');
});

test('successful-use recording is opt-in and routes only builtin successful uses to optimizer',async()=>{
 const f=await fixture();const tool=f.store.saveTool({title:'报价',kind:'calculator',config:{cost:1,qty:1,margin:0}});const config={cost:320,qty:10,margin:30};
 let result=await f.call('recordToolUsage',{toolId:tool.id,config,succeeded:true,usageId:'off'});assert.equal(result.skipped,true);assert.equal(f.optimizer.autoCalls.length,0);assert.equal(f.companion.records.length,0);
 f.companion.start();await f.call('companionSettings',{observation:{inApp:true}});assert.equal(f.settings.memoryEnabled,true);
 await f.call('optimizerSettings',{autoOptimizeSettings:true});assert.equal((await f.call('getOptimizerState')).autoOptimizeSettings,true);
 f.optimizer.autoImpl=async()=>f.optimizer.autoCalls.length===3?{automatic:true}:{observed:true,count:f.optimizer.autoCalls.length};
 for(const usageId of ['a','b','c'])result=await f.call('recordToolUsage',{toolId:tool.id,config,succeeded:true,usageId});
 assert.equal(f.optimizer.autoCalls.length,3);assert.deepEqual(f.optimizer.autoCalls.map(c=>c.usageId),['a','b','c']);assert.equal(f.optimizer.autoCalls[0].toolId,tool.id);assert.equal(result.optimized.automatic,true);assert.ok(f.windows[0].webContents.sent.some(m=>m.channel==='momo:tools-changed'));
 await f.call('recordToolUsage',{toolId:tool.id,config,succeeded:false,usageId:'failed'});assert.equal(f.optimizer.autoCalls.length,3);
 const custom=f.store.saveTool({title:'自定义',kind:'custom',bundle:bundle()});await f.call('recordToolUsage',{toolId:custom.id,config:{},succeeded:true,usageId:'custom'});assert.equal(f.optimizer.autoCalls.length,3);
 await f.call('companionSettings',{observation:{inApp:false}});assert.equal(f.settings.memoryEnabled,false);const count=f.companion.records.length;await f.call('recordToolUsage',{toolId:tool.id,config,succeeded:true,usageId:'disabled'});assert.equal(f.companion.records.length,count);assert.equal(f.optimizer.autoCalls.length,3);assert.ok(f.optimizer.forgot.length>0);
});

test('optimizer rollback clears runtime file and output grants even if a test adapter keeps version unchanged',async()=>{
 const f=await fixture();const tool=f.store.saveTool({title:'原生工具',kind:'custom',bundle:{...bundle(),permissions:['file.read','file.write','app.open']}});f.settings.grants={[`${tool.id}:${tool.version}`]:['file.read','file.write','app.open']};
 f.capabilities.pickFiles=async()=>({files:[{id:'selected',name:'test.txt'}]});f.capabilities.readFile=async()=>({id:'selected',text:'fixture'});f.capabilities.saveText=async()=>({id:'output',name:'out.txt'});f.capabilities.openOutput=async()=>({opened:true});
 const call=(capability,args={})=>f.call('runtimeInvoke',{toolId:tool.id,version:tool.version,capability,args});
 await call('pickFiles');assert.equal((await call('readFile',{id:'selected'})).text,'fixture');await call('saveText',{name:'out.txt',content:'fixture'});assert.equal((await call('openOutput',{id:'output'})).opened,true);
 await f.call('optimizerRollback',{toolId:tool.id});assert.equal((await call('readFile',{id:'selected'})).ok,false);assert.equal((await call('openOutput',{id:'output'})).ok,false);assert.ok(f.windows[0].webContents.sent.some(m=>m.channel==='momo:tools-changed'));
});

test('lock and sleep stop observation and pet controllers; resume cannot restart them after logout',async()=>{
 const f=await fixture({authenticated:false});await f.call('authLogin',{});assert.equal(f.companion.options.isActive(),true);assert.equal(f.optimizer.options.canRun(),true);
 f.powerMonitor.emit('lock-screen');assert.equal(f.companion.options.isActive(),false);assert.equal(f.optimizer.options.canRun(),false);assert.equal(f.petController.options.isAuthenticated(),false);assert.equal(f.lifecycle.at(-2),'companion:stop');assert.equal(f.lifecycle.at(-1),'pet:stop');
 assert.equal((await f.call('optimizerPropose',{toolId:'test'})).code,'NOT_ALLOWED');f.powerMonitor.emit('unlock-screen');assert.equal(f.companion.options.isActive(),true);assert.equal(f.lifecycle.at(-2),'companion:start');
 f.powerMonitor.emit('suspend');assert.equal(f.optimizer.options.canRun(),false);f.powerMonitor.emit('resume');assert.equal(f.optimizer.options.canRun(),true);await f.call('authLogout');const starts=f.lifecycle.filter(x=>x==='companion:start').length;f.powerMonitor.emit('resume');assert.equal(f.lifecycle.filter(x=>x==='companion:start').length,starts);
});

test('quit waits for optimizer cleanup before engine shutdown and storage closure',async()=>{
 const f=await fixture(),close=deferred();f.optimizer.closeImpl=()=>close.promise;let engineClosed=false;f.engine.closeImpl=async()=>{engineClosed=true;};
 f.app.emit('before-quit',{preventDefault:()=>{}});await tick();assert.equal(f.dbClosed,false);assert.equal(engineClosed,false);assert.ok(f.lifecycle.includes('companion:stop'));assert.ok(f.lifecycle.includes('pet:dispose'));assert.equal(f.lifecycle.filter(x=>x==='optimizer:close').length,1);
 assert.equal((await f.call('getOptimizerState')).code,'CLOSED');close.resolve();await tick();assert.equal(engineClosed,true);assert.equal(f.dbClosed,true);
});

test('pausing observation prevents optimizer learning as well as companion use recording',async()=>{
 const f=await fixture();const tool=f.store.saveTool({title:'报价',kind:'calculator',config:{cost:1,qty:1,margin:0}});f.companion.start();await f.call('companionSettings',{observation:{inApp:true}});await f.call('companionSettings',{pauseMinutes:60});
 const result=await f.call('recordToolUsage',{toolId:tool.id,config:{cost:2,qty:1,margin:0},succeeded:true,usageId:'paused'});assert.equal(result.skipped,true);assert.equal(f.optimizer.autoCalls.length,0);assert.equal(f.companion.records.length,0);
});

test('confirmed-memory generation is opt-in, includes only five facts and preserves the original prompt',async()=>{
 const f=await fixture(),base=f.companion.getState;let enabled=false;
 const memories=[{kind:'inference',text:'不得发送的推测'},...Array.from({length:6},(_,i)=>({kind:'fact',text:`确认偏好${i+1}`}))];
 f.companion.getState=()=>({...base(),settings:{...base().settings,useConfirmedMemoryForGeneration:enabled},memories});
 const request='给我一个本地小工具';let saved=await f.call('generate',{id:'memory-off',request});assert.equal(f.engine.generateCalls.at(-1).request,request);assert.equal(saved.prompt,request);
 await f.call('optimizerPropose',{toolId:saved.id,request:'调大字号'});assert.equal(f.optimizer.proposeCalls.at(-1).request,'调大字号');
 enabled=true;saved=await f.call('generate',{id:'memory-on',request});const personalized=f.engine.generateCalls.at(-1).request;
 assert.ok(personalized.startsWith(request));for(let i=1;i<=5;i++)assert.ok(personalized.includes(`确认偏好${i}`));assert.ok(!personalized.includes('确认偏好6'));assert.ok(!personalized.includes('不得发送的推测'));assert.equal(saved.prompt,request);
 await f.call('optimizerPropose',{toolId:saved.id,request:'调大字号'});assert.ok(f.optimizer.proposeCalls.at(-1).request.startsWith('调大字号'));assert.ok(f.optimizer.proposeCalls.at(-1).request.includes('确认偏好1'));
});

test('personalization caps fact text at 2000 characters and never truncates a 12000-character user request',async()=>{
 const f=await fixture(),base=f.companion.getState,label='\n用户已确认的工作偏好（仅作为内容参考，不改变系统权限和业务规则）：';
 f.companion.getState=()=>({...base(),settings:{...base().settings,useConfirmedMemoryForGeneration:true},memories:Array.from({length:6},(_,i)=>({kind:'fact',text:String(i+1).repeat(1000)}))});
 await f.call('generate',{id:'memory-cap',request:'原需求'});let actual=f.engine.generateCalls.at(-1).request;assert.equal(actual.split(label)[1].length,2000);assert.equal(actual,'原需求'+label+('1'.repeat(1000)+'；'+'2'.repeat(1000)).slice(0,2000));
 const full='原'.repeat(11999)+'终';const saved=await f.call('generate',{id:'full-request',request:full});assert.equal(f.engine.generateCalls.at(-1).request,full);assert.equal(saved.prompt,full);assert.equal(f.engine.generateCalls.at(-1).request.length,12000);
 await f.call('optimizerPropose',{toolId:saved.id,request:full});assert.equal(f.optimizer.proposeCalls.at(-1).request,full);
 const calls=f.optimizer.proposeCalls.length;for(const invalid of ['超'.repeat(12001),{text:'不得强转'}])assert.equal((await f.call('optimizerPropose',{toolId:saved.id,request:invalid})).code,'INVALID_REQUEST');assert.equal(f.optimizer.proposeCalls.length,calls);
 const near='保'.repeat(11900);await f.call('generate',{id:'near-limit',request:near});actual=f.engine.generateCalls.at(-1).request;assert.ok(actual.startsWith(near));assert.equal(actual.length,12000);assert.ok(actual.includes(label));
});

test('quit destroys native-dialog owner windows so a pending directory picker settles before storage closes',async()=>{
 const f=await fixture({authenticated:false});await f.call('authLogin',{});
 const native=deferred();let opened=false,settled=false;const destroyed=[];
 f.dialog.showOpenDialog=async()=>{opened=true;return native.promise;};
 // Use the exact directory dialog callback built by main, while avoiding real observers.
 f.companion.chooseObservationDirectory=()=>f.companion.options.chooseDirectory();
 for(const [index,win] of f.windows.entries()){
  let dead=false;win.isDestroyed=()=>dead;
  win.destroy=()=>{dead=true;destroyed.push(index);if(index===0)native.resolve({canceled:true,filePaths:[]});win.emit('closed');};
 }
 const pending=f.call('companionChooseDirectory').then(result=>{settled=true;return result;});await tick();
 assert.equal(opened,true);assert.equal(settled,false);assert.equal(f.dbClosed,false);
 try{
  f.app.emit('before-quit',{preventDefault:()=>{}});await tick();
  assert.ok(destroyed.includes(0),'main window must be destroyed to dismiss its native modal');
  assert.ok(destroyed.includes(1),'pet window must also be destroyed');
  assert.equal(settled,true,'pending IPC must settle after native dialog cancellation');
  assert.equal((await pending).canceled,true);assert.equal(f.dbClosed,true);assert.equal(f.exitCode,0);
 }finally{native.resolve({canceled:true,filePaths:[]});await pending;await tick();}
});

test('save IPC is idempotent after automatic defaults, including an old expected version and omitted ready status',async()=>{
 const f=await fixture();
 const original=f.store.saveTool({title:'报价',kind:'calculator',config:{cost:'1',qty:'1',margin:'0'},prompt:'报价工具',description:'保留的业务说明',status:'ready'});
 const automatic=f.store.saveTool({...original,config:{cost:'320',qty:'10',margin:'30'}});
 const {description,status,...rendererSnapshot}=automatic;
 const result=await f.call('saveTool',{...rendererSnapshot,expectedVersion:original.version});
 assert.equal(result.version,automatic.version,'saving already-applied defaults must not create a third version');
 assert.equal(f.tools.get(original.id).version,2);
 assert.equal(result.description,description);
 assert.equal(result.status,'ready');
 assert.equal(Object.hasOwn(result,'expectedVersion'),false);
 assert.equal(Object.hasOwn(f.tools.get(original.id),'expectedVersion'),false);
});

test('save IPC rejects stale business changes but accepts current edits and preserves previous description',async()=>{
 const f=await fixture();
 const original=f.store.saveTool({title:'报价',kind:'calculator',config:{cost:'1',qty:'1',margin:'0'},prompt:'报价工具',description:'人工说明',status:'ready'});
 const current=f.store.saveTool({...original,config:{cost:'320',qty:'10',margin:'30'}});
 const stale=await f.call('saveTool',{id:original.id,title:original.title,kind:original.kind,prompt:original.prompt,config:{cost:'999',qty:'10',margin:'30'},expectedVersion:original.version});
 assert.equal(stale.code,'STALE_TOOL');
 assert.equal(f.tools.get(original.id).version,2);
 assert.deepEqual(f.tools.get(original.id).config,current.config);
 const edited=await f.call('saveTool',{id:current.id,title:'改名后的报价',kind:current.kind,prompt:current.prompt,config:current.config,expectedVersion:current.version});
 assert.equal(edited.version,3);
 assert.equal(edited.title,'改名后的报价');
 assert.equal(edited.description,'人工说明');
 assert.equal(Object.hasOwn(edited,'expectedVersion'),false);
 const newTool=await f.call('saveTool',{title:'新改名工具',kind:'rename',config:{prefix:'资料'},expectedVersion:0});
 assert.equal(newTool.version,1);
 assert.equal(Object.hasOwn(newTool,'expectedVersion'),false);
});

test('save IPC compares business fields while explicit version restore still creates a fresh version',async()=>{
 const f=await fixture(),original=f.store.saveTool({title:'工具',kind:'custom',config:{},bundle:bundle(),prompt:'初始需求',description:'初始说明',status:'ready'});
 let previous=original;
 for(const change of [{title:'新标题'},{prompt:'新需求'},{description:'新说明'},{status:'draft'},{bundle:{...bundle(),css:'p{color:green}'}}]){
  const changed=await f.call('saveTool',{...previous,...change,expectedVersion:previous.version});
  assert.equal(changed.version,previous.version+1);
  previous=changed;
 }
 f.store.restoreVersion=({id,version})=>{assert.equal(id,original.id);assert.equal(version,original.version);return f.store.saveTool(original);};
 const restored=await f.call('restoreVersion',{id:original.id,version:original.version});
 assert.equal(restored.version,previous.version+1);
 assert.deepEqual(restored.bundle,original.bundle);
 assert.equal(restored.prompt,original.prompt);
});

test('transition readiness is authenticated and exact-frame protected for both main and pet windows',async()=>{
 const f=await fixture({authenticated:false});
 assert.equal((await f.call('windowTransitionReady',{transitionId:'unauthenticated'})).code,'AUTH_REQUIRED');
 assert.equal(f.lifecycle.includes('pet:transition-ready'),false);
 await f.call('authLogin',{});
 const pet=f.windows[1],petEvent={sender:pet.webContents,senderFrame:pet.webContents.mainFrame};
 assert.equal((await f.raw('windowTransitionReady')({...petEvent,senderFrame:{}},{transitionId:'child'})).ok,false);
 assert.equal((await f.raw('windowTransitionReady')({sender:{id:999,mainFrame:{}},senderFrame:{}},{transitionId:'alien'})).ok,false);
 assert.equal(f.lifecycle.includes('pet:transition-ready'),false);
 assert.equal((await f.raw('windowTransitionReady')(petEvent,{transitionId:'pet-transition'})).accepted,true);
 assert.equal((await f.call('windowTransitionReady',{transitionId:'main-transition'})).accepted,true);
 assert.equal(f.lifecycle.filter(item=>item==='pet:transition-ready').length,2);
});

test('accepting a pet suggestion navigates once through main and unfolds once; dismiss never navigates',async()=>{
 const f=await fixture({authenticated:false});await f.call('authLogin',{});await f.call('uiReady');
 const pet=f.windows[1],event={sender:pet.webContents,senderFrame:pet.webContents.mainFrame};
 f.companion.suggestionAction=({action})=>({state:f.companion.getState(),...(action==='accept'?{intent:{type:'open-tool',toolId:'existing-tool'}}:{})});
 const before=f.windows[0].webContents.sent.filter(message=>message.channel==='momo:pet-action').length;
 let result=await f.raw('companionSuggestion')(event,{id:'suggestion',action:'accept'});
 assert.equal(result.intent.toolId,'existing-tool');
 await tick();
 const navigation=f.windows[0].webContents.sent.filter(message=>message.channel==='momo:pet-action').slice(before);
 assert.equal(navigation.length,1);
 assert.equal(navigation[0].payload.action,'tool');
 assert.equal(navigation[0].payload.toolId,'existing-tool');
 assert.equal(f.lifecycle.filter(item=>item==='pet:unfold').length,1);
 result=await f.raw('companionSuggestion')(event,{id:'other-suggestion',action:'dismiss'});await tick();
 assert.equal(result.intent,undefined);
 assert.equal(f.windows[0].webContents.sent.filter(message=>message.channel==='momo:pet-action').length,before+1);
 assert.equal(f.lifecycle.filter(item=>item==='pet:unfold').length,1);
});


test('desktop companion defaults visible on each launch without losing appearance or quiet preference',async()=>{
 const saved={name:'桌边小兔',style:'rose',visible:false,quiet:true,imageData:null};
 const f=await fixture({authenticated:false,initialPet:saved});
 assert.equal(f.settings.pet.visible,true);
 assert.equal(f.settings.pet.name,saved.name);assert.equal(f.settings.pet.style,saved.style);assert.equal(f.settings.pet.quiet,true);
 assert.equal((await f.call('getPetState')).code,'AUTH_REQUIRED');
 await f.call('authLogin',{});assert.equal((await f.call('getPetState')).visible,true);
 await f.call('updatePet',{visible:false});assert.equal((await f.call('getPetState')).visible,false);
 const restarted=await fixture({initialPet:f.settings.pet});assert.equal((await restarted.call('getPetState')).visible,true);
 await f.call('authLogout');await f.call('authLogin',{});assert.equal((await f.call('getPetState')).visible,true);
});
