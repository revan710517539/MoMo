'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const LIMITS = Object.freeze({ memories:100, todos:200, suggestions:40, directories:5, usage:100, apps:30, audit:100, feedback:100 });
const DEFAULTS = Object.freeze({
  paused:false, pausedUntil:null, useConfirmedMemoryForGeneration:false,
  observation:{ inApp:false, directories:false, frontmost:false, excludedNames:['.git','node_modules','.ssh','.env','.DS_Store'], excludedApps:['com.1password.1password','com.agilebits.onepassword7','com.apple.keychainaccess','1Password','Keychain Access','钥匙串访问'] },
  breaks:{ enabled:false, workMinutes:50, restMinutes:5, idleCutoffSeconds:60 },
  suggestions:{ enabled:true, usageThreshold:3, fileChangeThreshold:5, cooldownMinutes:240 },
});
const RANGES=Object.freeze({workMinutes:[1,240],restMinutes:[1,60],idleCutoffSeconds:[10,300],usageThreshold:[2,50],fileChangeThreshold:[2,500],cooldownMinutes:[1,10080]});
const copy = value => JSON.parse(JSON.stringify(value));
const fail = (code,message) => Object.assign(new Error(message),{code});
const text = (value,max,label) => { if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw fail('COMPANION_INVALID_INPUT',`${label}无效或过长。`);return value.trim(); };
const iso = ms => new Date(ms).toISOString();
const cnNumber = value => {
  if(/^\d+$/.test(value))return Number(value);
  if(value==='半')return 0.5;
  const digits={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if(Object.hasOwn(digits,value))return digits[value];
  const parts=value.split('十');if(parts.length===2)return (parts[0]?digits[parts[0]]:1)*10+(parts[1]?digits[parts[1]]:0);
  return NaN;
};
function chinaParts(ms){const d=new Date(ms+8*3600000);return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate(),h:d.getUTCHours(),minute:d.getUTCMinutes()};}
function chinaDate(y,m,d,h,minute){const result=Date.UTC(y,m-1,d,h-8,minute);const parts=chinaParts(result);return parts.y===y&&parts.m===m&&parts.d===d&&parts.h===h&&parts.minute===minute?result:NaN;}
function absoluteTime(value){
  if(typeof value!=='string')return NaN;
  const local=value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/);
  if(local)return chinaDate(...local.slice(1).map(Number));
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
  const result=Date.parse(value);const p=value.match(/^(\d{4})-(\d{2})-(\d{2})/);if(!Number.isFinite(chinaDate(Number(p[1]),Number(p[2]),Number(p[3]),0,0)))return NaN;return result;
}

/** Deterministic Chinese time parsing, in Asia/Shanghai. Ambiguous expressions
 * yield an explicit confirmation proposal and are never silently scheduled. */
function parseReminderTime(input, now=Date.now()){
  const ambiguous=(message,candidates=[])=>({needsTimeConfirmation:true,message,candidates});
  if(typeof input!=='string'||!input.trim())return {dueAt:null,needsTimeConfirmation:false};
  const value=input.trim().replace(/\s+/g,'').replace(/^(?:请)?(?:提醒我|提醒)/,'');
  if(value.length>100)return ambiguous('时间描述过长，请选择明确日期和时间。');
  const relative=value.match(/^([零〇一二两三四五六七八九十\d]+|半)(分钟|分|小时|钟头)后$/);
  if(relative){const n=cnNumber(relative[1]),minutes=n*(/小时|钟头/.test(relative[2])?60:1);if(Number.isFinite(minutes)&&minutes>0&&minutes<=525600)return {dueAt:iso(now+minutes*60000),needsTimeConfirmation:false};return ambiguous('请将提醒时间设在一年以内。');}
  const exact=absoluteTime(input.trim());
  if(Number.isFinite(exact))return exact>now?{dueAt:iso(exact),needsTimeConfirmation:false}:ambiguous('这个时间已经过去，请确认或重新选择。',[{label:'使用这个时间',dueAt:iso(exact)}]);
  const match=value.match(/^(今天|明天|后天)?(早上|上午|中午|下午|晚上|傍晚)?([零〇一二两三四五六七八九十\d]{1,3})(?:点|[:：])(?:(半)|([零〇一二两三四五六七八九十\d]{1,3})(?:分)?)?$/);
  if(match){
    const current=chinaParts(now),day=match[1]||'今天',period=match[2],hour=cnNumber(match[3]),minute=match[4]?30:match[5]?cnNumber(match[5]):0;
    if(!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)return ambiguous('小时或分钟无效，请重新选择。');
    let h=hour;
    if(period){const ranges={'早上':[1,11],'上午':[1,11],'下午':[1,6],'晚上':[6,11],'傍晚':[5,7]};if(hour>12||(ranges[period]&&(hour<ranges[period][0]||hour>ranges[period][1]))||(period==='中午'&&![1,2,11,12].includes(hour)))return ambiguous('时段与小时不一致或有歧义，请用 24 小时制确认。');if(['下午','晚上','傍晚'].includes(period)&&hour<12)h+=12;if(period==='中午'&&hour<11)h+=12;}
    const offset=day==='明天'?1:day==='后天'?2:0;const base=new Date(Date.UTC(current.y,current.m-1,current.d+offset));
    const make=hh=>chinaDate(base.getUTCFullYear(),base.getUTCMonth()+1,base.getUTCDate(),hh,minute);
    if(!period&&hour>=1&&hour<=11&&!value.includes(':')&&!value.includes('：'))return ambiguous('“几点”还没有说明上午或下午，请确认。',[{label:`上午 ${hour}:${String(minute).padStart(2,'0')}`,dueAt:iso(make(hour))},{label:`下午 ${hour}:${String(minute).padStart(2,'0')}`,dueAt:iso(make(hour+12))}]);
    const target=make(h);return target>now?{dueAt:iso(target),needsTimeConfirmation:false}:ambiguous('这个时间已经过去，请选择明确时间。',[{label:'确认此时间',dueAt:iso(target)}]);
  }
  const vague=value.match(/^(今天|明天|后天)(上午|下午|晚上)$/);
  if(vague){const p=chinaParts(now),offset=vague[1]==='明天'?1:vague[1]==='后天'?2:0,base=new Date(Date.UTC(p.y,p.m-1,p.d+offset)),hour=vague[2]==='上午'?9:vague[2]==='下午'?15:20;return ambiguous('还没有具体几点，下面只是候选时间，需要你确认。',[{label:`${vague[1]}${vague[2]} ${hour}:00`,dueAt:iso(chinaDate(base.getUTCFullYear(),base.getUTCMonth()+1,base.getUTCDate(),hour,0))}]);}
  return ambiguous('暂时无法确定时间，请在日期时间选择器中确认；不会自动安排提醒。');
}
function blank(){return {version:1,settings:copy(DEFAULTS),memories:[],todos:[],suggestions:[],directories:[],usage:[],apps:[],frontmost:null,feedback:[],breakState:{activeMs:0,restUntil:null,lastPromptAt:null},audit:[]};}

function createCompanion({store,getTools=()=>[],emit=()=>{},notify=()=>{},getIdleSeconds=()=>Infinity,isActive=()=>false,now=Date.now,chooseDirectory,getFrontmost,watchDirectory=fs.watch}={}){
  if(!store||typeof store.getSettings!=='function'||typeof store.saveSettings!=='function')throw new TypeError('Companion requires settings storage');
  const stored=store.getSettings().companion;
  let data=stored==null?blank():copy(stored);
  if(!data||data.version!==1||!data.settings||Object.entries(LIMITS).some(([key,max])=>!Array.isArray(data[key])||data[key].length>max)||!data.breakState)throw fail('COMPANION_STORAGE_CORRUPT','陪伴数据格式异常，已停止观察；请保留数据后恢复。');
  const savedSettings=data.settings;data.settings=copy(DEFAULTS);
  const corrupt=()=>{throw fail('COMPANION_STORAGE_CORRUPT','陪伴数据格式异常，已停止观察；请保留数据后恢复。');};
  if(savedSettings.paused!=null){if(typeof savedSettings.paused!=='boolean')corrupt();data.settings.paused=savedSettings.paused;}
  if(savedSettings.useConfirmedMemoryForGeneration!=null){if(typeof savedSettings.useConfirmedMemoryForGeneration!=='boolean')corrupt();data.settings.useConfirmedMemoryForGeneration=savedSettings.useConfirmedMemoryForGeneration;}
  if(savedSettings.pausedUntil!=null){if(!Number.isFinite(absoluteTime(savedSettings.pausedUntil)))corrupt();data.settings.pausedUntil=savedSettings.pausedUntil;}
  for(const group of ['observation','breaks','suggestions'])if(savedSettings[group]!=null){if(typeof savedSettings[group]!=='object'||Array.isArray(savedSettings[group]))corrupt();for(const [field,value]of Object.entries(savedSettings[group])){if(!Object.hasOwn(DEFAULTS[group],field))corrupt();const prototype=DEFAULTS[group][field];if(typeof prototype==='boolean'){if(typeof value!=='boolean')corrupt();}else if(Array.isArray(prototype)){if(!Array.isArray(value)||value.length>60||value.some(v=>typeof v!=='string'||!v.trim()||v.length>100))corrupt();}else{const [min,max]=RANGES[field];if(!Number.isInteger(value)||value<min||value>max)corrupt();}data.settings[group][field]=copy(value);}}
  if(!Number.isFinite(data.breakState.activeMs)||data.breakState.activeMs<0||data.breakState.activeMs>86400000)corrupt();
  for(const key of Object.keys(LIMITS))if(data[key].some(item=>!item||typeof item!=='object'||Array.isArray(item)))corrupt();
  if(data.directories.some(d=>typeof d.id!=='string'||typeof d.name!=='string'||typeof d.directoryPath!=='string'||!path.isAbsolute(d.directoryPath)||!Number.isInteger(d.eventCount)||d.eventCount<0||d.eventCount>1000000))corrupt();
  if(data.memories.some(m=>typeof m.id!=='string'||typeof m.text!=='string'||m.text.length>1000||!['fact','inference'].includes(m.kind)))corrupt();
  if(data.todos.some(t=>typeof t.id!=='string'||typeof t.title!=='string'||t.title.length>200||typeof t.done!=='boolean'||(t.dueAt!==null&&!Number.isFinite(absoluteTime(t.dueAt)))))corrupt();
  if(data.usage.some(u=>typeof u.toolId!=='string'||!Number.isInteger(u.count)||u.count<0||u.count>1000000)||data.apps.some(a=>typeof a.bundleId!=='string'||typeof a.name!=='string'||!Number.isInteger(a.count)||a.count<0||a.count>1000000||(a.recentSwitches!=null&&(!Array.isArray(a.recentSwitches)||a.recentSwitches.length>10||a.recentSwitches.some(at=>!Number.isFinite(absoluteTime(at)))))))corrupt();
  let running=false,timer=null,epoch=0,lastTick=null,tickPromise=null,tickAbort=null,frontmostError=null;
  let savedSnapshot=JSON.stringify(stored==null?data:stored);
  const watchers=new Map(),pendingChanges=new Map();
  const time=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0||value>8000000000000000)throw fail('COMPANION_CLOCK_ERROR','系统时间无效。');return value;};
  const active=()=>{try{return isActive()===true;}catch{return false;}};
  const paused=()=>data.settings.paused||Boolean(data.settings.pausedUntil&&Date.parse(data.settings.pausedUntil)>time());
  const scheduled=()=>running&&active();
  const eligible=()=>scheduled()&&!paused();
  const tools=()=>{try{const result=getTools();return Array.isArray(result)?result:[];}catch{return [];}};
  function audit(kind,detail,sourceId){data.audit.unshift({id:randomUUID(),kind,detail:String(detail).slice(0,300),...(sourceId?{sourceId}:{}),at:iso(time())});data.audit.length=Math.min(data.audit.length,LIMITS.audit);}
  function getState(){
    const current=time(),settings=copy(data.settings);
    return {settings,memories:copy(data.memories),todos:copy(data.todos),suggestions:copy(data.suggestions),audit:copy(data.audit),observations:{directories:data.directories.map(d=>({id:d.id,name:d.name,eventCount:d.eventCount||0,lastChangeAt:d.lastChangeAt||null,watching:watchers.has(d.id),error:d.error||null})),usage:copy(data.usage),apps:copy(data.apps),frontmost:copy(data.frontmost),frontmostError,counts:{usage:data.usage.reduce((n,u)=>n+u.count,0),directoryEvents:data.directories.reduce((n,d)=>n+(d.eventCount||0),0),appSwitches:data.apps.reduce((n,a)=>n+a.count,0)}},runtime:{running,active:scheduled(),observing:eligible(),paused:paused(),frontmostAvailable:typeof getFrontmost==='function'&&!frontmostError,breakActiveSeconds:Math.floor((data.breakState.activeMs||0)/1000),restUntil:data.breakState.restUntil,resting:Boolean(data.breakState.restUntil&&Date.parse(data.breakState.restUntil)>current)}};
  }
  function publish(persist=true){if(persist){const snapshot=JSON.stringify(data);if(snapshot!==savedSnapshot){store.saveSettings({companion:JSON.parse(snapshot)});savedSnapshot=snapshot;}}const state=getState();try{emit(state);}catch{}return state;}
  function closeWatcher(id){const entry=watchers.get(id);if(entry){try{entry.close();}catch{}watchers.delete(id);}const batch=pendingChanges.get(id);if(batch?.timer)clearTimeout(batch.timer);pendingChanges.delete(id);}
  function closeWatchers(){for(const id of [...watchers.keys()])closeWatcher(id);for(const batch of pendingChanges.values())if(batch.timer)clearTimeout(batch.timer);pendingChanges.clear();}
  function excludedApp(app){const values=data.settings.observation.excludedApps;return values.some(v=>v.toLowerCase()===app.bundleId.toLowerCase()||v.toLowerCase()===app.name.toLowerCase());}
  function eventAllowed(filename){
    if(typeof filename!=='string'&&!Buffer.isBuffer(filename))return false;
    const name=String(filename);if(!name||name.length>255||/[\\/\x00-\x1f]/.test(name)||name.startsWith('.'))return false;
    if(data.settings.observation.excludedNames.some(v=>name.toLowerCase()===v.toLowerCase()))return false;
    return !/\.(?:key|pem|p12|pfx|kdbx|keychain|keychain-db)$/i.test(name);
  }
  function feedback(key){return data.feedback.find(f=>f.key===key);}
  function canSuggest(key){const prior=feedback(key);return (key==='break'?data.settings.breaks.enabled:data.settings.suggestions.enabled)&&(!prior||Date.parse(prior.nextEligibleAt)<=time())&&!data.suggestions.some(s=>s.key===key&&['pending','snoozed'].includes(s.status));}
  function addSuggestion({key,kind,title,reason,evidence,intent,sourceId}){
    if(!canSuggest(key))return null;
    const record={id:randomUUID(),key,kind,title,reason,evidence,intent,sourceId:sourceId||null,status:'pending',createdAt:iso(time()),lastNotifiedAt:null,snoozedUntil:null};
    data.suggestions.unshift(record);data.suggestions.length=Math.min(data.suggestions.length,LIMITS.suggestions);audit('suggestion-created','依据本机已允许的事件生成一条建议',record.id);return record;
  }
  function directorySuggestion(d){
    const threshold=data.settings.suggestions.fileChangeThreshold;if((d.eventCount||0)<threshold)return;
    const tool=tools().find(t=>t.kind==='rename');
    addSuggestion({key:`directory:${d.id}`,sourceId:d.id,kind:'directory',title:'要整理这个目录里的工作吗？',reason:`你选的目录「${d.name}」已观察到 ${d.eventCount} 次变更事件；只统计事件，不读取内容或保存文件名。`,evidence:{type:'directory-metadata',count:d.eventCount,at:d.lastChangeAt},intent:tool?{type:'open-tool',toolId:tool.id}:{type:'create-tool',request:`制作一个本机文件整理工具：由我选择文件，先预览再按规则重命名，保留撤销记录。`}});
  }
  function appSuggestion(app){
    const recentCount=(app.recentSwitches||[]).length;
    if(recentCount<3||!['com.microsoft.excel','com.apple.iwork.numbers'].includes(app.bundleId.toLowerCase())||excludedApp(app))return;
    const tool=tools().find(t=>t.kind==='compare');if(!tool)return;
    addSuggestion({key:`app:${app.bundleId}`,kind:'app',title:'有两份表格需要核对吗？',reason:`在已允许的观察中，过去 24 小时多次切回表格应用（已观察到 ${recentCount} 次）。有两份表需要核对时，可以用「${String(tool.title||'表格核对工具').slice(0,100)}」。这只是应用切换线索，未读取表格内容，也不表示已判断你的任务。`,evidence:{type:'frontmost-app-switches',bundleId:app.bundleId,name:app.name,count:recentCount,at:app.lastSeenAt},intent:{type:'open-tool',toolId:tool.id}});
  }
  function flushDirectory(id){
    const batch=pendingChanges.get(id);if(!batch)return;clearTimeout(batch.timer);pendingChanges.delete(id);
    if(!eligible()||!data.settings.observation.directories)return;
    const directory=data.directories.find(d=>d.id===id);if(!directory)return;
    directory.eventCount=Math.min(1000000,(directory.eventCount||0)+batch.count);directory.lastChangeAt=iso(time());directory.error=null;directorySuggestion(directory);audit('directory-events',`合并统计 ${batch.count} 次目录变更事件`,id);publish();
  }
  function enqueueDirectory(id,filename){
    if(!eligible()||!data.settings.observation.directories||!eventAllowed(filename)||!data.directories.some(d=>d.id===id))return;
    let batch=pendingChanges.get(id);if(!batch){batch={count:0,firstAt:time(),timer:null};pendingChanges.set(id,batch);batch.timer=setTimeout(()=>flushDirectory(id),750);batch.timer.unref?.();}batch.count=Math.min(500,batch.count+1);
  }
  function safeDirectory(candidate){
    if(typeof candidate!=='string'||!path.isAbsolute(candidate))throw fail('COMPANION_DIRECTORY_INVALID','请选择一个本机目录。');
    const absolute=path.resolve(candidate),parsed=path.parse(absolute);let current=parsed.root;
    for(const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){current=path.join(current,segment);if(fs.lstatSync(current).isSymbolicLink())throw fail('COMPANION_DIRECTORY_INVALID','不观察符号链接目录，请选择实际目录。');}
    if(!fs.lstatSync(absolute).isDirectory())throw fail('COMPANION_DIRECTORY_INVALID','请选择普通目录。');return fs.realpathSync(absolute);
  }
  function syncWatchers(){
    if(!eligible()||!data.settings.observation.directories){closeWatchers();return;}
    for(const id of [...watchers.keys()])if(!data.directories.some(d=>d.id===id))closeWatcher(id);
    for(const d of data.directories){try{
      if(safeDirectory(d.directoryPath)!==d.directoryPath)throw Error('changed');
      if(watchers.has(d.id))continue;
      const watcher=watchDirectory(d.directoryPath,{persistent:false,recursive:false},(_kind,filename)=>enqueueDirectory(d.id,filename));watchers.set(d.id,watcher);d.error=null;
      watcher.on?.('error',()=>{if(watchers.get(d.id)!==watcher)return;closeWatcher(d.id);d.error='目录观察已停止，请确认目录仍然存在。';audit('directory-unavailable','目录观察已停止',d.id);publish();});
    }catch{closeWatcher(d.id);d.error='目录暂不可用，未继续观察。';}}
  }
  function listStrings(value,label){if(!Array.isArray(value)||value.length>60)throw fail('COMPANION_INVALID_INPUT',`${label}最多 60 项。`);return [...new Set(value.map(v=>text(v,100,label)))];}
  function updateSettings(patch={}){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw fail('COMPANION_INVALID_INPUT','设置无效。');
    const allowed=new Set(['observation','breaks','suggestions','paused','pausedUntil','pauseMinutes','useConfirmedMemoryForGeneration']);if(Object.keys(patch).some(k=>!allowed.has(k)))throw fail('COMPANION_INVALID_INPUT','设置包含不支持的字段。');
    const next=copy(data.settings);
    for(const key of ['observation','breaks','suggestions'])if(patch[key]!=null){if(typeof patch[key]!=='object'||Array.isArray(patch[key]))throw fail('COMPANION_INVALID_INPUT','设置分组无效。');for(const [field,value]of Object.entries(patch[key])){
      if(!Object.hasOwn(DEFAULTS[key],field))throw fail('COMPANION_INVALID_INPUT','设置包含不支持的字段。');
      if(typeof DEFAULTS[key][field]==='boolean'){if(typeof value!=='boolean')throw fail('COMPANION_INVALID_INPUT','开关必须为布尔值。');next[key][field]=value;}
      else if(Array.isArray(DEFAULTS[key][field]))next[key][field]=listStrings(value,'排除项');
      else{const [min,max]=RANGES[field];if(!Number.isInteger(value)||value<min||value>max)throw fail('COMPANION_INVALID_INPUT',`${field}超出可用范围。`);next[key][field]=value;}
    }}
    if(Object.hasOwn(patch,'paused')){if(typeof patch.paused!=='boolean')throw fail('COMPANION_INVALID_INPUT','暂停设置无效。');next.paused=patch.paused;if(!patch.paused)next.pausedUntil=null;}
    if(Object.hasOwn(patch,'useConfirmedMemoryForGeneration')){if(typeof patch.useConfirmedMemoryForGeneration!=='boolean')throw fail('COMPANION_INVALID_INPUT','记忆参考开关无效。');next.useConfirmedMemoryForGeneration=patch.useConfirmedMemoryForGeneration;}
    if(Object.hasOwn(patch,'pausedUntil')){if(patch.pausedUntil===null)next.pausedUntil=null;else{const target=absoluteTime(patch.pausedUntil);if(!Number.isFinite(target)||target<=time()||target>time()+30*86400000)throw fail('COMPANION_INVALID_INPUT','暂停结束时间必须在未来 30 天内。');next.pausedUntil=iso(target);next.paused=false;}}
    if(Object.hasOwn(patch,'pauseMinutes')){if(!Number.isInteger(patch.pauseMinutes)||patch.pauseMinutes<0||patch.pauseMinutes>43200)throw fail('COMPANION_INVALID_INPUT','暂停时长无效。');next.paused=false;next.pausedUntil=patch.pauseMinutes?iso(time()+patch.pauseMinutes*60000):null;}
    epoch++;tickAbort?.abort();data.settings=next;lastTick=null;closeWatchers();
    if(!next.observation.frontmost||next.paused||(next.pausedUntil&&Date.parse(next.pausedUntil)>time())){data.frontmost=null;frontmostError=null;}
    data.apps=data.apps.filter(app=>!excludedApp(app));if(data.frontmost&&excludedApp(data.frontmost))data.frontmost=null;
    data.suggestions=data.suggestions.filter(s=>s.kind!=='app'||!excludedApp({bundleId:s.evidence?.bundleId||'',name:s.evidence?.name||''}));
    audit('settings-updated','陪伴观察或提醒设置已更新');syncWatchers();return publish();
  }
  function saveMemory(input={}){
    const content=text(input.text,1000,'记忆内容');const kind=input.kind||'fact';if(!['fact','inference'].includes(kind))throw fail('COMPANION_INVALID_INPUT','请选择事实或待确认推断。');
    const existing=input.id?data.memories.find(m=>m.id===input.id):null;if(input.id&&!existing)throw fail('COMPANION_NOT_FOUND','找不到这条记忆。');if(!existing&&data.memories.length>=LIMITS.memories)throw fail('COMPANION_LIMIT','记忆已达上限，请先删除不需要的条目。');
    const record={id:existing?.id||randomUUID(),text:content,kind,source:input.source?text(input.source,120,'记忆来源'):'用户手动记录',createdAt:existing?.createdAt||iso(time()),updatedAt:iso(time())};
    if(existing)data.memories.splice(data.memories.indexOf(existing),1,record);else data.memories.unshift(record);audit(existing?'memory-edited':'memory-added',kind==='fact'?'保存一条用户确认事实':'保存一条待确认推断',record.id);return publish();
  }
  function deleteMemory({id}={}){const index=data.memories.findIndex(m=>m.id===id);if(index<0)throw fail('COMPANION_NOT_FOUND','找不到这条记忆。');data.memories.splice(index,1);audit('memory-deleted','用户删除了一条记忆',id);return publish();}
  function saveTodo(input={}){
    const existing=input.id?data.todos.find(t=>t.id===input.id):null;if(input.id&&!existing)throw fail('COMPANION_NOT_FOUND','找不到这条待办。');
    const title=text(input.title??existing?.title,200,'待办标题');if(!existing&&data.todos.length>=LIMITS.todos)throw fail('COMPANION_LIMIT','待办已达上限。');
    if(Object.hasOwn(input,'confirmedTime')&&typeof input.confirmedTime!=='boolean')throw fail('COMPANION_INVALID_INPUT','时间确认标记无效。');
    let dueAt=existing?.dueAt||null,changedTime=false;
    if(Object.hasOwn(input,'snoozeMinutes')){if(!Number.isInteger(input.snoozeMinutes)||input.snoozeMinutes<1||input.snoozeMinutes>10080)throw fail('COMPANION_INVALID_INPUT','稍后提醒时长无效。');dueAt=iso(time()+input.snoozeMinutes*60000);changedTime=true;}
    else if(Object.hasOwn(input,'dueAt')){if(input.dueAt===null)dueAt=null;else{const target=absoluteTime(input.dueAt);if(!Number.isFinite(target))throw fail('COMPANION_INVALID_INPUT','提醒日期时间无效。');if(target<=time()&&!input.confirmedTime)return {needsTimeConfirmation:true,message:'此时间已过去，确认后才会安排。',candidates:[{label:'确认此时间',dueAt:iso(target)}]};dueAt=iso(target);}changedTime=true;}
    else if(Object.hasOwn(input,'timeText')){if(typeof input.timeText!=='string'||input.timeText.length>100)throw fail('COMPANION_INVALID_INPUT','时间描述过长。');const parsed=parseReminderTime(input.timeText,time());if(parsed.needsTimeConfirmation)return parsed;dueAt=parsed.dueAt;changedTime=true;}
    if(Object.hasOwn(input,'done')&&typeof input.done!=='boolean')throw fail('COMPANION_INVALID_INPUT','待办状态无效。');
    const record={id:existing?.id||randomUUID(),title,dueAt,done:Object.hasOwn(input,'snoozeMinutes')?false:input.done??existing?.done??false,createdAt:existing?.createdAt||iso(time()),updatedAt:iso(time()),remindedFor:changedTime?null:existing?.remindedFor||null,lastRemindedAt:existing?.lastRemindedAt||null,delivery:changedTime?null:existing?.delivery||null};
    if(existing)data.todos.splice(data.todos.indexOf(existing),1,record);else data.todos.unshift(record);audit(existing?'todo-edited':'todo-added','用户保存了一条待办',record.id);return publish();
  }
  function deleteTodo({id}={}){const index=data.todos.findIndex(t=>t.id===id);if(index<0)throw fail('COMPANION_NOT_FOUND','找不到这条待办。');data.todos.splice(index,1);audit('todo-deleted','用户删除了一条待办',id);return publish();}
  async function chooseObservationDirectory(){
    if(typeof chooseDirectory!=='function')throw fail('COMPANION_UNAVAILABLE','目录选择器尚未接入。');
    const expected=epoch,selection=await chooseDirectory();if(expected!==epoch||!active())return {...getState(),canceled:true};
    const candidate=typeof selection==='string'?selection:selection?.canceled?null:selection?.filePaths?.[0]||selection?.path;
    if(!candidate)return {...getState(),canceled:true};if(data.directories.length>=LIMITS.directories)throw fail('COMPANION_LIMIT','最多观察 5 个明确选择的目录。');
    let directoryPath;try{directoryPath=safeDirectory(candidate);}catch{throw fail('COMPANION_DIRECTORY_INVALID','请选择存在的普通目录，不能使用符号链接。');}
    if(data.directories.some(d=>d.directoryPath===directoryPath))return getState();
    data.directories.push({id:randomUUID(),name:path.basename(directoryPath)||'已选择目录',directoryPath,eventCount:0,lastChangeAt:null,error:null});audit('directory-authorized','用户明确选择了一个目录');syncWatchers();return publish();
  }
  function removeObservationDirectory({id}={}){const index=data.directories.findIndex(d=>d.id===id);if(index<0)throw fail('COMPANION_NOT_FOUND','找不到这个观察目录。');closeWatcher(id);data.directories.splice(index,1);data.suggestions=data.suggestions.filter(s=>s.sourceId!==id);data.feedback=data.feedback.filter(f=>f.key!==`directory:${id}`);audit('directory-removed','用户移除了一个目录授权');return publish();}
  function recordUsage({toolId,kind}={}){
    if(!eligible()||!data.settings.observation.inApp)return getState();
    const tool=tools().find(t=>t.id===toolId);if(!tool)return getState();
    const safeKind=typeof kind==='string'?kind.slice(0,60):tool.kind||'tool';let usage=data.usage.find(u=>u.toolId===toolId&&u.kind===safeKind);
    if(!usage){usage={toolId,kind:safeKind,title:String(tool.title||'工作工具').slice(0,100),count:0,firstAt:iso(time()),lastAt:null};data.usage.unshift(usage);data.usage.length=Math.min(data.usage.length,LIMITS.usage);}
    usage.count=Math.min(1000000,usage.count+1);usage.lastAt=iso(time());
    if(usage.count>=data.settings.suggestions.usageThreshold)addSuggestion({key:`usage:${toolId}`,kind:'usage',title:`还要继续用「${usage.title}」吗？`,reason:`在已开启的应用内观察中，你已使用这个工具 ${usage.count} 次。`,evidence:{type:'in-app-usage',count:usage.count,at:usage.lastAt},intent:{type:'open-tool',toolId}});
    audit('tool-used','记录一次用户允许的应用内工具使用',toolId);return publish();
  }
  function setFeedback(key,action,minutes){let item=feedback(key);if(!item){item={key,dismissals:0,nextEligibleAt:null,lastActionAt:null};data.feedback.unshift(item);data.feedback.length=Math.min(data.feedback.length,LIMITS.feedback);}if(action==='dismiss')item.dismissals=Math.min(10,item.dismissals+1);const interval=action==='snooze'?minutes*60000:action==='accept'?(key==='break'?data.settings.breaks.restMinutes*60000:86400000):Math.min(7*86400000,data.settings.suggestions.cooldownMinutes*60000*2**item.dismissals);item.nextEligibleAt=iso(time()+interval);item.lastActionAt=iso(time());}
  function suggestionAction({id,action,minutes=10}={}){
    const suggestion=data.suggestions.find(s=>s.id===id);if(!suggestion)throw fail('COMPANION_NOT_FOUND','找不到这条建议。');if(!['accept','dismiss','snooze'].includes(action))throw fail('COMPANION_INVALID_INPUT','建议操作无效。');if(!['pending','snoozed'].includes(suggestion.status))throw fail('COMPANION_INVALID_INPUT','这条建议已处理。');if(!Number.isInteger(minutes)||minutes<1||minutes>10080)throw fail('COMPANION_INVALID_INPUT','稍后时长无效。');
    let intent=null;
    if(action==='accept'){
      if(suggestion.kind==='break'){data.breakState.activeMs=0;data.breakState.restUntil=iso(time()+data.settings.breaks.restMinutes*60000);lastTick=null;intent={type:'rest',until:data.breakState.restUntil};}
      else{intent=copy(suggestion.intent);if(intent?.type==='open-tool'&&!tools().some(t=>t.id===intent.toolId))throw fail('COMPANION_NOT_FOUND','建议中的工具已归档，请重新选择。');}
    }
    suggestion.status=action==='snooze'?'snoozed':action==='accept'?'accepted':'dismissed';suggestion.snoozedUntil=action==='snooze'?iso(time()+minutes*60000):null;setFeedback(suggestion.key,action,minutes);audit('suggestion-action',action==='accept'?'用户接受一条建议':action==='dismiss'?'用户拒绝一条建议，后续降频':'用户稍后处理一条建议',id);return {state:publish(),intent};
  }
  async function deliver(payload,expected){if(!scheduled()||expected!==epoch)return false;return boundedCall(async({signal})=>{await notify({...payload,signal});return true;},false);}
  async function performTick(){
    if(!running)return getState();
    if(data.settings.pausedUntil&&Date.parse(data.settings.pausedUntil)<=time()){data.settings.pausedUntil=null;audit('pause-ended','限时暂停已结束');}
    if(!scheduled()){lastTick=null;closeWatchers();return publish(false);}
    const expected=epoch,current=time();syncWatchers();
    for(const [id,batch]of [...pendingChanges])if(current-batch.firstAt>=750)flushDirectory(id);
    let idle;try{idle=Number(await boundedCall(getIdleSeconds,Infinity));}catch{idle=Infinity;}if(expected!==epoch||!scheduled())return getState();
    const elapsed=lastTick===null?0:current-lastTick;lastTick=current;
    if(elapsed<0||elapsed>60000){audit('clock-gap','检测到时钟变化或休眠间隔，未计入工作时长');}
    else if(data.settings.breaks.enabled&&Number.isFinite(idle)&&idle>=0&&idle<data.settings.breaks.idleCutoffSeconds){const activeElapsed=data.breakState.restUntil?Math.max(0,current-Math.max(current-elapsed,Date.parse(data.breakState.restUntil))):elapsed;data.breakState.activeMs=Math.min(24*3600000,(data.breakState.activeMs||0)+activeElapsed);}
    if(data.breakState.restUntil&&Date.parse(data.breakState.restUntil)<=current)data.breakState.restUntil=null;
    if(eligible()&&data.settings.observation.frontmost&&typeof getFrontmost==='function'){
      let app;try{app=await boundedCall(getFrontmost,null);}catch{app=null;}if(expected!==epoch||!scheduled())return getState();
      if(app&&typeof app.bundleId==='string'&&typeof app.name==='string'&&app.bundleId.trim()&&app.name.trim()&&app.bundleId.length<=160&&app.name.length<=100&&!/[\x00-\x1f]/.test(app.bundleId+app.name)){
        frontmostError=null;
        const observed={bundleId:app.bundleId,name:app.name};
        if(!excludedApp(observed)){
          if(data.frontmost?.bundleId!==observed.bundleId){const measuredSwitch=Boolean(data.frontmost?.bundleId);let item=data.apps.find(a=>a.bundleId===observed.bundleId);if(!item){item={...observed,count:0,lastSeenAt:null};data.apps.unshift(item);data.apps.length=Math.min(data.apps.length,LIMITS.apps);}item.count=Math.min(1000000,item.count+1);item.lastSeenAt=iso(time());item.recentSwitches=(item.recentSwitches||[]).filter(at=>Date.parse(at)>=time()-86400000&&Date.parse(at)<=time()).slice(-9);if(measuredSwitch)item.recentSwitches.push(item.lastSeenAt);appSuggestion(item);}data.frontmost={...observed,at:iso(time())};
        }else data.frontmost=null;
      }else{data.frontmost=null;frontmostError='暂未取得前台应用信息；请确认观察组件可用，或稍后重试。';}
    }
    for(const suggestion of data.suggestions)if(suggestion.status==='snoozed'&&Date.parse(suggestion.snoozedUntil)<=time()){suggestion.status='pending';suggestion.snoozedUntil=null;if(suggestion.kind==='break')suggestion.lastNotifiedAt=null;}
    if(data.settings.breaks.enabled&&(data.breakState.activeMs||0)>=data.settings.breaks.workMinutes*60000)addSuggestion({key:'break',kind:'break',title:'给眼睛和身体休息一下',reason:`累计约 ${Math.floor(data.breakState.activeMs/60000)} 分钟有效活动；闲置、锁屏和休眠间隔不计入。`,evidence:{type:'active-time',seconds:Math.floor(data.breakState.activeMs/1000)},intent:{type:'rest'}});
    // Claim and persist each reminder before calling the OS. A crash after claim
    // cannot repeat it on restart; failed delivery remains visible for explicit snooze/retry.
    let delivered=0;
    for(const todo of data.todos.filter(t=>!t.done&&t.dueAt&&Date.parse(t.dueAt)<=time()&&t.remindedFor!==t.dueAt).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt))){
      if(delivered>=3||expected!==epoch||!scheduled())break;todo.remindedFor=todo.dueAt;todo.lastRemindedAt=iso(time());todo.delivery='pending';audit('todo-reminder','已提交一条到期待办提醒',todo.id);publish();
      const success=await deliver({title:'待办提醒',body:todo.title,kind:'todo',id:todo.id},expected);const latest=data.todos.find(t=>t.id===todo.id);if(latest&&latest.remindedFor===todo.dueAt)latest.delivery=success?'sent':'failed';delivered++;
    }
    const rest=data.suggestions.find(s=>s.kind==='break'&&s.status==='pending'&&!s.lastNotifiedAt);
    if(rest&&data.settings.breaks.enabled&&expected===epoch&&scheduled()){rest.lastNotifiedAt=iso(time());data.breakState.lastPromptAt=rest.lastNotifiedAt;publish();await deliver({title:'休息一下',body:`已经持续活动了一会儿，要休息 ${data.settings.breaks.restMinutes} 分钟吗？`,kind:'break',id:rest.id},expected);}
    if(expected!==epoch||!running)return getState();return publish();
  }
  function boundedCall(fn,fallback){const signal=tickAbort?.signal;return new Promise(resolve=>{let settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(deadline);signal?.removeEventListener('abort',abort);resolve(value);};const abort=()=>finish(fallback);const deadline=setTimeout(abort,3000);if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});Promise.resolve().then(()=>signal?.aborted?fallback:fn({signal})).then(finish,()=>finish(fallback));});}
  function tick(){if(tickPromise)return tickPromise;tickAbort=new AbortController();tickPromise=performTick().finally(()=>{tickPromise=null;tickAbort=null;});return tickPromise;}
  function start(){if(running)return getState();running=true;epoch++;lastTick=null;syncWatchers();timer=setInterval(()=>{tick().catch(()=>{});},15000);timer.unref?.();return publish(false);}
  function stop(){running=false;epoch++;tickAbort?.abort();lastTick=null;data.frontmost=null;frontmostError=null;if(timer)clearInterval(timer);timer=null;closeWatchers();return publish();}
  function forgetObservations(){epoch++;tickAbort?.abort();lastTick=null;frontmostError=null;closeWatchers();data.usage=[];data.directories=[];data.apps=[];data.frontmost=null;data.suggestions=data.suggestions.filter(s=>s.kind==='break');data.feedback=data.feedback.filter(f=>f.key==='break');data.settings.observation.inApp=false;data.settings.observation.directories=false;data.settings.observation.frontmost=false;data.audit=[];audit('observations-forgotten','用户关闭观察并清除观察历史与目录授权');return publish();}
  return {getState,updateSettings,saveMemory,deleteMemory,saveTodo,deleteTodo,chooseObservationDirectory,removeObservationDirectory,recordUsage,suggestionAction,tick,start,stop,forgetObservations};
}

module.exports={createCompanion,parseReminderTime};
