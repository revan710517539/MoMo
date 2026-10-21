'use strict';
const {randomUUID}=require('node:crypto');
const {Script}=require('node:vm');
const fail=(code,message)=>Object.assign(Error(message),{code});
const copy=value=>JSON.parse(JSON.stringify(value));
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const equal=(a,b)=>stable(a)===stable(b);
const ACTIVE=new Set(['running','review']);

function validateConfig(kind,config){
  if(!config||typeof config!=='object'||Array.isArray(config))throw fail('INVALID_CONFIG','请提供完整的工具参数');
  const keys={compare:['key','amount'],rename:['prefix'],calculator:['cost','qty','margin']}[kind];
  if(!keys||Object.keys(config).some(key=>!keys.includes(key)))throw fail('INVALID_CONFIG','包含不能自动调整的规则或参数');
  if(kind==='compare'){
    if(typeof config.key!=='string'||!config.key.trim()||config.amount===config.key)throw fail('INVALID_CONFIG','请选择有效且不同的匹配字段与金额字段');
    for(const value of Object.values(config))if(typeof value!=='string'||value.length>150||/[\x00-\x1f]/.test(value))throw fail('INVALID_CONFIG','核对字段格式无效');
  }
  if(kind==='rename'&&(typeof config.prefix!=='string'||!config.prefix.trim()||config.prefix.length>120||/[\\/:*?"<>|\x00-\x1f]/.test(config.prefix)||/[. ]$/.test(config.prefix)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(config.prefix)))throw fail('INVALID_CONFIG','文件名前缀无效');
  if(kind==='calculator'){
    for(const key of keys)if(!['string','number'].includes(typeof config[key])||String(config[key]).trim()===''||!Number.isFinite(Number(config[key])))throw fail('INVALID_CONFIG','报价输入无效');
    const {cost,qty,margin}=Object.fromEntries(keys.map(key=>[key,Number(config[key])]));
    if(cost<0||qty<=0||margin<0||margin>=100||!Number.isFinite(cost*qty/(1-margin/100)))throw fail('INVALID_CONFIG','报价参数超出允许范围');
  }
  return copy(config);
}

function createOptimizer({store,engine,validateBundle,emit=()=>{},now=()=>Date.now(),canRun=()=>true,canAutoOptimize=()=>true,validateCandidate}={}){
  if(!store||typeof validateBundle!=='function')throw TypeError('optimizer requires store and validateBundle');
  const loaded=store.getSettings().optimizer;
  const state=loaded&&loaded.schema===1?copy(loaded):{schema:1,candidates:[],chains:{},observations:{}};
  state.chains=Object.assign(Object.create(null),state.chains);
  state.observations=Object.assign(Object.create(null),state.observations);
  let closed=false;
  const jobs=new Map(),busy=new Set();
  const time=()=>new Date(now()).toISOString();
  const snapshot=()=>copy({...state,closed,rollbacks:Object.entries(state.chains).map(([toolId,chain])=>({toolId,...chain}))});
  function persist(){store.saveSettings({optimizer:copy(state)});try{emit({type:'optimizer',state:snapshot()});}catch{}}
  function audit(c,status=c.status){store.saveTask?.({id:c.id,type:'optimization',title:`优化：${c.before?.title||'工作工具'}`,status:status==='review'?'pending':status,candidateId:c.id,toolId:c.toolId,baseVersion:c.baseVersion,...(c.appliedVersion?{targetVersion:c.appliedVersion}:{}),...(c.error?{error:c.error}:{})});}
  for(const c of state.candidates)if(c.status==='running'){c.status='interrupted';c.error='应用退出时优化中断，原工具保持不变';c.updatedAt=time();}
  for(const c of state.candidates)if(c.status==='applying'){
    const tool=store.listTools().find(t=>t.id===c.toolId);
    if(tool?.version===c.expectedVersion&&equal(tool.config,c.after.config)&&equal(tool.bundle,c.after.bundle)&&tool.title===c.after.title){c.status='applied';c.appliedVersion=tool.version;state.chains[c.toolId]={stableVersion:c.rollbackStableVersion||c.baseVersion,currentVersion:tool.version,candidateId:c.id,updatedAt:time()};}
    else{c.status='interrupted';c.error='启用时应用退出，请检查当前工具版本后重新优化';}
  }
  for(const c of state.candidates.filter(c=>['interrupted','applied'].includes(c.status)))audit(c);
  persist();
  async function guard(){if(closed)throw fail('CLOSED','优化服务已关闭');if(!await canRun())throw fail('NOT_ALLOWED','当前状态不能优化，请先登录并检查设置');}
  function automaticAllowed(){try{return canAutoOptimize()===true;}catch{return false;}}
  const current=id=>{const tool=store.listTools().find(t=>t.id===id);if(!tool)throw fail('STALE_TOOL','工具已归档或不存在，请重新打开');return tool;};
  const candidate=id=>{const c=state.candidates.find(c=>c.id===id);if(!c)throw fail('NOT_FOUND','优化候选不存在');return c;};
  function assertBase(c){const tool=current(c.toolId);if(tool.version!==c.baseVersion)throw fail('STALE_TOOL','原工具已有新版本，此候选不能覆盖它，请重新优化');return tool;}
  function changed(before,after){const fields=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!equal(before[key],after[key]));return fields.map(field=>({field,before:before[field]??null,after:after[field]??null}));}
  function configCandidate(tool,config,request){
    const next=validateConfig(tool.kind,config),fields=changed(tool.config||{},next);
    if(!fields.length)throw fail('NO_CHANGE','参数与当前工具相同，无需新增版本');
    return {after:{...copy(tool),config:next},diff:{fields:fields.map(f=>({...f,field:`config.${f.field}`})),permissionsAdded:[],permissionsRemoved:[],calculationRulesChanged:tool.kind==='compare',note:tool.kind==='calculator'?'仅保存已确认的输入默认值，不修改计算公式':'仅调整预设工具参数'},autoEligible:tool.kind!=='compare',requiresTrial:tool.kind==='compare',requiresConfirmation:true,validation:{structure:'passed',syntax:'not-applicable',parameters:'passed',originalRules:'unchanged',permissions:'unchanged',render:'not-run',businessCorrectness:'not-tested'}};
  }
  async function propose({toolId,request='',config}={}){
    await guard();const tool=copy(current(toolId));
    if(typeof request!=='string'||request.length>12000)throw fail('INVALID_REQUEST','优化需求需为不超过12000字的文字，不会截断原需求');
    if(busy.has(toolId)||state.candidates.some(c=>c.toolId===toolId&&ACTIVE.has(c.status)))throw fail('BUSY','该工具已有待处理优化，请先试用或放弃候选');
    if(busy.size>=2)throw fail('BUSY','已有两个优化任务进行中，请稍后重试');
    if(state.candidates.length>=30){const index=state.candidates.findLastIndex(c=>!ACTIVE.has(c.status)&&c.status!=='applying');if(index<0)throw fail('CAPACITY','待审候选已满，请先处理或放弃候选');state.candidates.splice(index,1);}
    const id=`optimizer:${randomUUID()}`,c={id,toolId,baseVersion:tool.version,status:'running',source:config!==undefined?'parameters':'opencode',request,before:tool,createdAt:time(),updatedAt:time(),trial:{passed:false},requiresTrial:true,requiresConfirmation:true};
    state.candidates.unshift(c);busy.add(toolId);persist();audit(c);
    const work=(async()=>{
      // Defer work until the job registry is populated, including synchronous validation failures.
      await Promise.resolve();
      try{
        if(config!==undefined){Object.assign(c,configCandidate(tool,config,request));}
        else{
          if(tool.kind!=='custom')throw fail('INVALID_REQUEST','预设工具请先选择已确认的参数；自由规则优化适用于自定义工具');
          if(!engine?.generate)throw fail('NOT_CONFIGURED','尚未连接 OpenCode 优化引擎，请先配置模型');
          if(engine.status){const status=await engine.status();if(status.configured===false)throw fail('NOT_CONFIGURED',status.reason||'模型尚未配置，原工具未修改');if(status.installed===false)throw fail('NOT_INSTALLED',status.reason||'未找到 OpenCode 引擎');}
          await guard();
          const generated=await engine.generate({id,request:c.request||'优化当前工具的易用性和清晰度；保持业务规则、输入输出及权限不变，返回完整工具。',previous:tool.bundle});
          if(closed||c.status!=='running')throw fail('CANCELLED','优化已取消，原工具保持不变');
          const bundle=validateBundle(generated);
          try{new Script(bundle.js,{filename:'optimizer-candidate.js'});}catch{throw fail('INVALID_SYNTAX','候选代码有语法错误，未替换原工具');}
          const oldPermissions=tool.bundle?.permissions||[],newPermissions=bundle.permissions||[];
          const smoke=validateCandidate?await validateCandidate(bundle,{toolId,candidateId:id}):null;
          if(smoke===false||smoke?.passed===false)throw fail('INVALID_CANDIDATE','候选未通过受限运行检查，原工具保持不变');
          Object.assign(c,{after:{...copy(tool),title:bundle.title,description:bundle.description,bundle},diff:{fields:changed(tool.bundle||{},bundle).filter(f=>f.field!=='permissions'),permissionsAdded:newPermissions.filter(p=>!oldPermissions.includes(p)),permissionsRemoved:oldPermissions.filter(p=>!newPermissions.includes(p)),calculationRulesChanged:true,note:'源码变化尚未证明业务正确，必须检查差异并试用；新版本本机权限需重新授权'},validation:{structure:'passed',syntax:'passed',originalRules:'requires-user-review',permissions:equal(oldPermissions,newPermissions)?'unchanged':'changed',render:smoke?.passed===true?'passed':'not-run',businessCorrectness:'not-tested'},requiresTrial:true,requiresConfirmation:true});
          if(equal(tool.bundle,bundle))throw fail('NO_CHANGE','模型没有产生变化，原工具保持不变');
        }
        await guard();if(c.status!=='running')throw fail('CANCELLED','候选已放弃，原工具保持不变');assertBase(c);c.status='review';c.updatedAt=time();persist();audit(c);return copy(c);
      }catch(error){if(c.status!=='dismissed'){c.status=closed||error.code==='CANCELLED'?'interrupted':error.code==='STALE_TOOL'?'stale':'failed';c.error=error.code==='NOT_CONFIGURED'||error.code==='NOT_INSTALLED'||error.code==='STALE_TOOL'||error.code==='NO_CHANGE'||error.code==='INVALID_CONFIG'||error.code==='INVALID_SYNTAX'||error.code==='INVALID_CANDIDATE'?error.message:'本次优化未完成，原工具保持不变';c.code=error.code||'OPTIMIZER_ERROR';c.updatedAt=time();persist();audit(c);}throw error;}
      finally{busy.delete(toolId);jobs.delete(id);}
    })();jobs.set(id,work);return work;
  }
  async function markTrial({id,passed}={}){await guard();const c=candidate(id);if(c.status!=='review')throw fail('INVALID_STATE','只有待审候选可以记录试用');assertBase(c);c.trial={passed:passed===true,at:time(),source:'user-confirmation'};c.updatedAt=time();persist();return copy(c);}
  async function applyInternal({id,confirmed=false}={},automatic=false){
    await guard();const c=candidate(id);if(c.status!=='review')throw fail('INVALID_STATE','候选尚未准备好或已处理');
    const before=assertBase(c);
    const settings=store.getSettings(),observation=state.observations[c.toolId];
    const autoAuthorized=automatic&&automaticAllowed()&&c.autoEligible===true&&settings.autoOptimizeSettings===true&&settings.memoryEnabled!==false&&observation?.count>=3&&observation.baseVersion===before.version&&observation.key===stable(c.after.config);
    if(confirmed!==true&&!autoAuthorized)throw fail('CONFIRMATION_REQUIRED','请检查差异，明确确认规则和权限变化后再启用');
    if(c.requiresTrial&&!c.trial?.passed)throw fail('TRIAL_REQUIRED','请先试用候选并确认结果，再启用');
    if(c.source==='opencode'){validateBundle(c.after.bundle);new Script(c.after.bundle.js);}else validateConfig(c.after.kind,c.after.config);
    // Write-ahead relation lets a restart recover a saved version if settings write was interrupted.
    c.status='applying';c.updatedAt=time();c.expectedVersion=before.version+1;c.rollbackStableVersion=before.version;persist();
    try{const tool=store.saveTool({...copy(c.after),id:before.id});c.status='applied';c.appliedVersion=tool.version;c.appliedAt=time();c.updatedAt=time();state.chains[c.toolId]={stableVersion:c.rollbackStableVersion,currentVersion:tool.version,candidateId:c.id,updatedAt:time()};delete state.observations[c.toolId];persist();audit(c,'completed');return {candidate:copy(c),tool};}
    catch(error){c.status='failed';c.error='启用未完成，请检查工具当前版本';persist();throw error;}
  }
  async function rollback({toolId}={}){
    await guard();const chain=state.chains[toolId];if(!chain)throw fail('NO_ROLLBACK','没有可回退的优化版本');
    const tool=current(toolId);if(tool.version!==chain.currentVersion)throw fail('STALE_TOOL','工具已被其他修改更新，为防止覆盖，请从版本历史选择恢复');
    const restored=store.restoreVersion({id:toolId,version:chain.stableVersion});
    for(const c of state.candidates)if(c.toolId===toolId&&(c.status==='applied'||c.status==='review')){c.status=c.status==='applied'?'rolled_back':'stale';c.updatedAt=time();}
    delete state.chains[toolId];delete state.observations[toolId];persist();store.saveTask?.({id:`optimizer-rollback:${randomUUID()}`,type:'optimization',title:`恢复稳定版：${tool.title}`,toolId,status:'completed',baseVersion:tool.version,targetVersion:restored.version});return restored;
  }
  async function dismiss({id}={}){await guard();const c=candidate(id);if(!['review','running','failed','interrupted','stale'].includes(c.status))throw fail('INVALID_STATE','此候选不能放弃');c.status='dismissed';c.updatedAt=time();if(jobs.has(id))engine?.cancel?.(id);persist();audit(c,'cancelled');return copy(c);}
  async function forgetUsage({toolId}={}){await guard();if(toolId!==undefined){if(typeof toolId!=='string'||!toolId)throw fail('INVALID_REQUEST','工具标识无效');delete state.observations[toolId];}else state.observations=Object.create(null);persist();return snapshot();}
  async function autoOptimizeUsage({toolId,config,usageId,succeeded=true}={}){
    await guard();const settings=store.getSettings();
    if(!automaticAllowed())return {skipped:true,reason:'observation-disabled'};
    if(settings.autoOptimizeSettings!==true||settings.memoryEnabled===false){if(state.observations[toolId]){delete state.observations[toolId];persist();}return {skipped:true,reason:'disabled'};}
    if(succeeded!==true)return {skipped:true,reason:'unsuccessful'};
    const tool=current(toolId);if(!['compare','rename','calculator'].includes(tool.kind))return {skipped:true,reason:'custom-requires-review'};
    const next=validateConfig(tool.kind,config);
    if(equal(tool.config||{},next)){delete state.observations[toolId];persist();return {skipped:true,reason:'no-change'};}
    const key=stable(next),previous=state.observations[toolId];
    const observation=previous?.key===key&&previous.baseVersion===tool.version?previous:{key,config:next,baseVersion:tool.version,count:0,usageIds:[]};
    // Missing usage IDs do not count: typing or repeat renderer IPC must never create versions.
    if(typeof usageId!=='string'||!usageId||usageId.length>150)return {skipped:true,reason:'usage-id-required'};
    if(observation.usageIds.includes(usageId))return {skipped:true,reason:'duplicate-usage'};
    observation.usageIds.push(usageId);observation.usageIds=observation.usageIds.slice(-20);observation.count++;observation.updatedAt=time();state.observations[toolId]=observation;persist();
    if(observation.count<3)return {observed:true,count:observation.count,required:3};
    if(state.candidates.some(c=>c.toolId===toolId&&ACTIVE.has(c.status)))return {skipped:true,reason:'candidate-pending'};
    const c=await propose({toolId,config:next,request:'将多次成功使用的参数保存为默认值'});
    if(!c.autoEligible)return {candidate:c,reviewRequired:true};
    // Recheck preference at the final boundary; turning observation off stops automatic application.
    if(!automaticAllowed()||store.getSettings().autoOptimizeSettings!==true||store.getSettings().memoryEnabled===false)return {candidate:c,reviewRequired:true};
    try{const result=await applyInternal({id:c.id,confirmed:false},true);return {...result,automatic:true};}
    catch(error){if(error.code==='CONFIRMATION_REQUIRED')return {candidate:copy(candidate(c.id)),reviewRequired:true};throw error;}
  }
  async function close(){if(closed)return;closed=true;for(const [id]of jobs){const c=candidate(id);if(c.status==='running'){c.status='interrupted';c.error='应用退出时优化中断，原工具保持不变';}engine?.cancel?.(id);}persist();await Promise.allSettled([...jobs.values()]);}
  return {getState:snapshot,propose,markTrial,apply:args=>applyInternal(args,false),rollback,dismiss,forgetUsage,autoOptimizeUsage,close};
}
module.exports={createOptimizer};
