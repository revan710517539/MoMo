import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ShieldCheck, WarningCircle, CircleNotch, X, CheckCircle, ClockCounterClockwise, GearSix, PlugsConnected } from '@phosphor-icons/react';
import { buildRuntimeDocument } from './runtime-document.js';
import { desktopCall, friendlyError, isDesktop } from './desktop-api.js';
import './desktop-panels.css';

const capabilities = new Set(['pickFiles', 'readFile', 'saveText', 'readClipboard', 'writeClipboard', 'notify', 'openOutput']);
const labels = {'file.read':'选择与读取文件','file.write':'保存结果','clipboard.read':'读取剪贴板','clipboard.write':'复制结果','notification':'完成提醒','app.open':'打开输出文件',pickFiles:'选择文件', readFile:'读取选定文件', saveText:'保存结果', readClipboard:'读取剪贴板', writeClipboard:'复制结果', notify:'完成提醒', openOutput:'打开输出文件'};
function ErrorMessage({ children }) { return children ? <div className="desktop-error" role="alert"><WarningCircle size={20}/><span>{children}</span></div> : null; }
function Panel({ title, onClose, children }) { return <section className="desktop-panel"><header><h2>{title}</h2>{onClose && <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20}/></button>}</header>{children}</section>; }

export function CustomTool({ tool, notify = () => {} }) {
  const frame = useRef(null), [reload, setReload] = useState(0), [ready,setReady] = useState(false), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const token = useMemo(() => crypto.randomUUID().replaceAll('-', ''), [tool.id, tool.version, reload, tool.bundle]);
  const documentResult = useMemo(() => { try { return {html:buildRuntimeDocument(tool.bundle,{token})}; } catch(e) { return {error:friendlyError(e)}; } }, [tool.bundle,token]);
  useEffect(() => { setReady(false); setError(''); const inFlight=new Set();let readyTimer;let active=true;
    const receive = async event => {
      const data=event.data;
      if(event.source!==frame.current?.contentWindow || !data || data.token!==token) return;
      if(data.momoReady) {clearTimeout(readyTimer);setReady(true);return;}
      if(data.momoRuntimeError) {setError(String(data.message).slice(0,500));return;}
      if(!data.momoRuntime || !Number.isSafeInteger(data.id) || data.id<1 || inFlight.has(data.id)) return;
      inFlight.add(data.id);const source=event.source;
      try {
        if(!capabilities.has(data.capability)) throw new Error('这个操作暂时不受支持。');
        const result=await desktopCall('runtimeInvoke',{toolId:tool.id,version:tool.version,capability:data.capability,args:data.args || {}});
        if(active)source.postMessage({momoResponse:true,token,id:data.id,result},'*');
      } catch(e) { if(active)source.postMessage({momoResponse:true,token,id:data.id,error:friendlyError(e)},'*'); }
      finally {inFlight.delete(data.id);}
    };
    window.addEventListener('message',receive); readyTimer=setTimeout(()=>{setReady(true);setError('工具打开超时，请重新打开或修改工具。')},8000);
    return ()=>{active=false;window.removeEventListener('message',receive);clearTimeout(readyTimer);};
  },[tool.id,tool.version,token]);
  async function authorize(revoke=false) {setBusy(true);setError('');try {await desktopCall('authorizeTool',{id:tool.id,...(revoke?{revoke:true}:{})});if(revoke)setReload(v=>v+1);notify(revoke?'已撤销本机访问权限':'已更新工具授权');}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
  const permissions=tool.bundle?.permissions || [];
  return <section className="custom-tool"><div className="runtime-toolbar"><div><span className="runtime-dot"/><strong>{tool.title}</strong><small>在你的电脑上运行</small></div><div><button className="secondary" onClick={()=>authorize()} disabled={busy}><ShieldCheck size={17}/>授权本机能力</button><button className="secondary" onClick={()=>{setReload(v=>v+1);}}><ArrowClockwise size={17}/>重新打开</button></div></div>
    {permissions.length>0 && <div className="runtime-permissions"><ShieldCheck size={16}/><span>需要：{permissions.map(p=>labels[typeof p==='string'?p:p.capability] || (typeof p==='string'?p:p.capability)).join('、')}</span><button onClick={()=>authorize(true)} disabled={busy}>撤销授权</button></div>}
    <ErrorMessage>{documentResult.error || error}</ErrorMessage>
    {!isDesktop() && <p className="desktop-hint">当前可以预览界面；文件与剪贴板等能力需在桌面应用中使用。</p>}
    {!documentResult.error && <div className="runtime-frame-wrap">{!ready && <div className="runtime-loading"><CircleNotch className="spin" size={22}/>正在打开你的小工具…</div>}<iframe key={token} ref={frame} title={`${tool.title}运行界面`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={documentResult.html}/></div>}
  </section>;
}

export function DesktopSettings({ onClose, notify = () => {} }) {
  const [form,setForm]=useState({provider:'custom',baseURL:'',model:'',apiKey:'',opencodePath:''}), [hasKey,setHasKey]=useState(false), [status,setStatus]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState('');
  useEffect(()=>{let live=true;Promise.all([desktopCall('getSettings'),desktopCall('engineStatus')]).then(([settings,engine])=>{if(!live)return;setForm(v=>({...v,...settings,apiKey:''}));setHasKey(Boolean(settings.hasApiKey));setStatus(engine);}).catch(e=>live&&setError(friendlyError(e)));return()=>{live=false;};},[]);
  const update=(key,value)=>setForm(v=>({...v,[key]:value}));
  async function save(e){e.preventDefault();setBusy(true);setError('');try { const payload={...form,provider:'custom'};delete payload.hasApiKey;if(!payload.apiKey.trim())delete payload.apiKey;await desktopCall('saveSettings',payload);setHasKey(hasKey||Boolean(form.apiKey));setForm(v=>({...v,apiKey:''}));setStatus(await desktopCall('engineStatus'));notify('制作引擎设置已保存');}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
  return <Panel title="制作引擎设置" onClose={onClose}><p className="desktop-description">连接你选择的模型，用自然语言制作工具。已保存的工具仍可在本机使用。</p><form className="desktop-form" onSubmit={save}>
    <label>模型接口地址<input value={form.baseURL} onChange={e=>update('baseURL',e.target.value)} placeholder="https://api.example.com/v1" required type="url"/><small>支持 OpenAI 兼容接口。制作时，你输入的需求和当前工具代码会发送到此服务。</small></label>
    <label>模型名称<input value={form.model} onChange={e=>update('model',e.target.value)} placeholder="填写服务商提供的模型名称" required/></label>
    <label>图像模型名称（可选）<input value={form.imageModel||''} onChange={e=>update('imageModel',e.target.value)} placeholder="需要宠物形象生成时填写"/><small>使用同一接口地址和密钥，需支持 images/generations 与 base64 图片输出。</small></label><label>API 密钥<input type="password" autoComplete="new-password" value={form.apiKey} onChange={e=>update('apiKey',e.target.value)} placeholder={hasKey?'密钥已保存；留空继续使用':'输入你的 API 密钥'}/><small>密钥由桌面应用加密保存，不显示已保存的内容。</small></label>
    <details><summary>更多设置</summary><label>OpenCode 程序路径<input value={form.opencodePath || ''} onChange={e=>update('opencodePath',e.target.value)} placeholder="留空自动寻找"/></label></details>
    {status && <div className="desktop-engine-status"><PlugsConnected size={18}/><span>{status.available || status.installed || status.ok ? '已找到 OpenCode 制作引擎' : '尚未找到 OpenCode，请安装或指定程序路径'}{status.version && <small>{status.version}</small>}</span></div>}
    <ErrorMessage>{error}</ErrorMessage><button className="primary" type="submit" disabled={busy}>{busy?<CircleNotch className="spin" size={18}/>:<GearSix size={18}/>}保存设置</button>
  {hasKey&&<button type="button" className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{await desktopCall('saveSettings',{clearApiKey:true});setHasKey(false);notify('已移除保存的模型密钥')}catch(e){setError(friendlyError(e))}finally{setBusy(false)}}}>移除已保存的密钥</button>}</form></Panel>;
}

export function TaskHistory({ notify = () => {} }) {
  const [tasks,setTasks]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  async function refresh(){try {const data=await desktopCall('listTasks');setTasks(Array.isArray(data)?data:data.tasks||[]);setError('');}catch(e){setError(friendlyError(e));}finally{setLoading(false);}}
  useEffect(()=>{refresh();const timer=setInterval(refresh,3000);return()=>clearInterval(timer);},[]);
  const statusLabel={undone:'已恢复文件名',interrupted:'上次退出时中断',queued:'等待中',pending:'等待中',running:'进行中',generating:'制作中',completed:'已完成',succeeded:'已完成',success:'已完成',failed:'未完成',cancelled:'已取消',canceled:'已取消'};
  return <Panel title="最近任务"><div className="desktop-panel-actions"><p className="desktop-description">制作和运行的记录，都保存在这里。</p><button className="secondary" onClick={refresh}><ArrowClockwise size={16}/>刷新</button></div><ErrorMessage>{error}</ErrorMessage>{loading?<p className="desktop-empty">正在读取任务…</p>:tasks.length===0?<div className="desktop-empty"><ClockCounterClockwise size={34}/><p>还没有任务，做一个自己的小工具吧。</p></div>:<div className="desktop-history">{tasks.map(task=><article key={task.id}><span className={`task-status ${task.status}`}>{['completed','succeeded','success'].includes(task.status)?<CheckCircle size={20}/>:['running','generating'].includes(task.status)?<CircleNotch className="spin" size={20}/>:<ClockCounterClockwise size={20}/>}</span><div><strong>{task.title || '工具任务'}</strong><small>{statusLabel[task.status] || '状态更新中'} · {task.createdAt?new Date(task.createdAt).toLocaleString('zh-CN'):''}</small>{task.error && <p className="task-error">{String(typeof task.error==='string'?task.error:task.error.message||'操作未完成')}</p>}</div>{task.operationId&&task.recoverable===true&&<button className="secondary" onClick={async()=>{try{const result=await desktopCall('undoOperation',{operationId:task.operationId});await refresh();notify(result.canceled?'已取消恢复':'文件名称已恢复')}catch(e){setError(friendlyError(e))}}}>恢复文件名</button>}{task.type==='generation'&&['running','queued','pending','generating'].includes(task.status)&&<button className="secondary" onClick={async()=>{try{await desktopCall('cancelGeneration',{id:task.id});await refresh();notify('已请求取消任务');}catch(e){setError(friendlyError(e));}}}>取消</button>}</article>)}</div>}</Panel>;
}

export function VersionHistory({tool,onRestore,onClose,notify=()=>{}}) {
  const [versions,setVersions]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{desktopCall('listVersions',{id:tool.id}).then(value=>setVersions(Array.isArray(value)?value:value.versions||[])).catch(e=>setError(friendlyError(e)));},[tool.id]);
  async function restore(version){setBusy(true);try{const value=await desktopCall('restoreVersion',{id:tool.id,version});await onRestore?.(value);notify('已恢复工具版本');onClose?.();}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
  return <Panel title="工具版本" onClose={onClose}><p className="desktop-description">{tool.title} · 恢复以前的版本后，仍可继续修改。</p><ErrorMessage>{error}</ErrorMessage><div className="desktop-history">{versions.length===0?<p className="desktop-empty">暂时没有历史版本。</p>:versions.map((v,index)=><article key={v.version ?? v.id ?? index}><ClockCounterClockwise size={21}/><div><strong>版本 {v.version ?? index+1}</strong><small>{v.createdAt?new Date(v.createdAt).toLocaleString('zh-CN'):v.title || '已保存'}</small></div><button className="secondary" disabled={busy} onClick={()=>restore(v.version ?? v.id)}>恢复此版本</button></article>)}</div></Panel>;
}

export function ArchivedTools({ onRestore, notify = () => {} }) {
  const [tools,setTools]=useState([]),[loading,setLoading]=useState(true),[restoring,setRestoring]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    desktopCall('listArchivedTools').then(value=>{if(active)setTools(Array.isArray(value)?value:value.tools||[]);}).catch(e=>{if(active)setError(friendlyError(e));}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);
  async function restore(tool){
    setRestoring(tool.id);setError('');
    try{
      const saved=await desktopCall('restoreVersion',{id:tool.id,version:tool.version});
      setTools(value=>value.filter(item=>item.id!==tool.id));
      await onRestore?.(saved);
      notify(`「${tool.title}」已回到我的工具`);
    }catch(e){setError(friendlyError(e));}finally{setRestoring(null);}
  }
  return <Panel title="归档的工具"><p className="desktop-description">暂时收起来的工具都在这里，恢复后可以继续使用。</p><ErrorMessage>{error}</ErrorMessage>{loading?<p className="desktop-empty" role="status">正在读取归档…</p>:tools.length===0?<div className="desktop-empty"><ClockCounterClockwise size={34}/><p>还没有归档的工具。</p></div>:<div className="desktop-history">{tools.map(tool=><article key={tool.id}><ClockCounterClockwise size={21}/><div><strong>{tool.title}</strong><small>最近保存：{tool.updatedAt||tool.createdAt?new Date(tool.updatedAt||tool.createdAt).toLocaleString('zh-CN'):'日期未记录'}</small></div><button className="secondary" disabled={Boolean(restoring)} onClick={()=>restore(tool)}>{restoring===tool.id?<><CircleNotch className="spin" size={16}/>正在恢复…</>:'恢复到我的工具'}</button></article>)}</div>}</Panel>;
}
