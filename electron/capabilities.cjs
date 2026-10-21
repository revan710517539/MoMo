const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const LIMIT = 8 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.csv','.txt','.md','.json','.log','.tsv','.html','.css','.js','.xml','.yaml','.yml']);
// OS open handlers may execute .bat/.command/.js even when the contents were written as text.
const OUTPUT_EXTENSIONS = new Set(['.csv','.txt','.md','.json','.log','.tsv','.html','.css','.xml','.yaml','.yml']);
function createCapabilities({ store, dialog, shell, clipboard, Notification, getWindow }) {
  const files = new Map(), plans = new Map();
  const exists = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
  function regular(file) {
    // Inspect every component: a selected file must not grant traversal through symlink directories.
    const absolute = path.resolve(file), parsed = path.parse(absolute);
    let current = parsed.root;
    for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (fs.lstatSync(current).isSymbolicLink()) throw Error('不支持符号链接文件或目录');
    }
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile()) throw Error('请选择普通文件');
    return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
  }
  function same(file, snapshot) { const now = regular(file); if (Object.keys(snapshot).some(k => snapshot[k] !== now[k])) throw Error('文件在选择后已发生变化，请重新选择'); return now; }
  const publicFile = (id, file) => ({ id, name: path.basename(file) });
  const safeName = name => typeof name === 'string' && name.length > 0 && name.length <= 180 && name.trim() === name && !/[\x00-\x1f<>:"/\\|?*]/.test(name) && name !== '.' && name !== '..' && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
  async function confirm(message, detail) { const answer = await dialog.showMessageBox(getWindow(), { type:'warning', buttons:['取消','确认执行'], defaultId:0, cancelId:0, message, detail, noLink:true }); return answer.response === 1; }
  // link + unlink gives atomic no-overwrite destination creation (rename alone overwrites on POSIX).
  function moveNoOverwrite(source, target) {
    fs.linkSync(source, target);
    try { fs.unlinkSync(source); } catch (error) { try { fs.unlinkSync(target); } catch {} throw error; }
  }
  const cleanOperation = op => ({ operationId: op.id, id: op.id, status: op.status, items: op.items?.map(i => ({oldName:path.basename(i.source),newName:path.basename(i.target)})) });
  return {
    async pickFiles({ multiple = false, kind = 'text' } = {}) {
      const result = await dialog.showOpenDialog(getWindow(), { properties: ['openFile', ...(multiple ? ['multiSelections'] : [])], ...(kind === 'csv' ? { filters:[{name:'CSV 表格',extensions:['csv']}] } : {}) });
      if (result.canceled) return { canceled: true, files: [] };
      const selected = result.filePaths.map(file => { const snapshot = regular(file), id = randomUUID(); return { id, file: path.resolve(file), snapshot }; });
      for (const item of selected) files.set(item.id, item);
      return { canceled:false, files:selected.map(i => publicFile(i.id, i.file)) };
    },
    readFile({ id } = {}) {
      const item = files.get(id); if (!item) throw Error('请先通过文件选择器授权此文件');
      same(item.file, item.snapshot);
      if (!TEXT_EXTENSIONS.has(path.extname(item.file).toLowerCase())) throw Error('仅支持文本文件；表格请另存为 CSV');
      if (item.snapshot.size > LIMIT) throw Error('文件超过 8 MB，请先拆分文件');
      const text = fs.readFileSync(item.file, 'utf8');
      same(item.file, item.snapshot);
      if (text.includes('\u0000')) throw Error('文件不是可读取的文本格式');
      return { ...publicFile(id, item.file), text };
    },
    async saveText({ name = '结果.txt', content } = {}) {
      if (!safeName(name) || typeof content !== 'string') throw Error('导出文件名称或内容无效');
      if (!OUTPUT_EXTENSIONS.has(path.extname(name).toLowerCase())) throw Error('请导出为 CSV、TXT、HTML 或其他受支持的文本格式');
      if (Buffer.byteLength(content, 'utf8') > LIMIT) throw Error('导出内容超过 8 MB');
      const result = await dialog.showSaveDialog(getWindow(), { defaultPath:name, title:'保存工具输出' });
      if (result.canceled || !result.filePath) return { canceled:true };
      const file = path.resolve(result.filePath);
      if (!safeName(path.basename(file))) throw Error('导出名称无效');
      if (!OUTPUT_EXTENSIONS.has(path.extname(file).toLowerCase())) throw Error('不支持保存可执行或脚本类型的输出文件');
      if (fs.realpathSync(path.dirname(file)) !== path.dirname(file)) throw Error('不支持保存到符号链接目录');
      const op = store.addOperation({type:'output',status:'writing',path:file,name:path.basename(file)});
      try { fs.writeFileSync(file, content, { encoding:'utf8', flag:'wx', mode:0o600 }); const snapshot = regular(file); store.updateOperation(op.id,{status:'completed',snapshot}); return {id:op.id,name:path.basename(file),canceled:false}; }
      catch (error) { store.updateOperation(op.id,{status:'failed',error:error.code || 'SAVE_FAILED'}); const failure=error.code==='EEXIST'?Error('目标文件已存在，请选择新名称，原文件未覆盖'):error;failure.operationId=op.id;throw failure; }
    },
    planRename({ fileIds, prefix } = {}) {
      if (!Array.isArray(fileIds) || !fileIds.length || new Set(fileIds).size !== fileIds.length || fileIds.length > 500) throw Error('请选择 1 到 500 个不同文件');
      if (!safeName(prefix)) throw Error('前缀无效：请勿使用路径、特殊字符或保留名称');
      const selected = fileIds.map(id => { const item = files.get(id); if (!item) throw Error('文件授权已失效，请重新选择'); same(item.file,item.snapshot); return item; });
      if (new Set(selected.map(i => i.file)).size !== selected.length) throw Error('不能重复选择同一文件');
      const items = selected.map((item,index) => { const target = path.join(path.dirname(item.file),`${prefix}_${String(index+1).padStart(3,'0')}${path.extname(item.file)}`); if (!safeName(path.basename(target))) throw Error('生成的文件名过长或无效'); if (target === item.file || exists(target)) throw Error(`目标名称「${path.basename(target)}」已存在，请更换前缀`); return {source:item.file,target,snapshot:item.snapshot}; });
      const id=randomUUID(); plans.set(id,{id,items});
      return {id,items:items.map(i=>({oldName:path.basename(i.source),newName:path.basename(i.target)})),count:items.length};
    },
    async executeRename({ planId } = {}) {
      const plan=plans.get(planId); if(!plan) throw Error('改名预览已失效，请重新预览');
      // Consume before await: concurrent requests cannot execute the same plan twice.
      plans.delete(planId);
      if (!await confirm(`确认重命名 ${plan.items.length} 个文件？`,plan.items.map(i=>`${path.basename(i.source)} → ${path.basename(i.target)}`).join('\n').slice(0,6000))) { store.addOperation({type:'rename',status:'canceled',items:plan.items});return {canceled:true}; }
      const op=store.addOperation({type:'rename',status:'running',items:plan.items,completed:[]});
      const done=[];
      try {
        // Validate every entry before touching any file.
        for(const item of plan.items){same(item.source,item.snapshot);if(exists(item.target))throw Error('目标文件已存在，已停止执行');}
        for(const [index,item] of plan.items.entries()) {
          same(item.source,item.snapshot);
          store.updateOperation(op.id,{pending:index});
          moveNoOverwrite(item.source,item.target); done.push(index);
          store.updateOperation(op.id,{completed:[...done],pending:null});
        }
        return cleanOperation(store.updateOperation(op.id,{status:'completed'}));
      } catch(error) {
        const rollbackErrors=[];
        for(const index of [...done].reverse()) {const item=plan.items[index];try{same(item.target,item.snapshot);if(exists(item.source))throw Error('原位置被占用');moveNoOverwrite(item.target,item.source);}catch(e){rollbackErrors.push({index,error:e.code||e.message});}}
        store.updateOperation(op.id,{status:rollbackErrors.length?'rollback_failed':'rolled_back',error:error.code||error.message,rollbackErrors});
        const failed=Error(rollbackErrors.length?'改名中断，部分文件未恢复。请保留操作记录并重试撤销。':'改名未完成，已恢复已变更文件。'); failed.operationId=op.id; throw failed;
      }
    },
    async undoOperation({ operationId } = {}) {
      const op=store.getOperation(operationId);
      if(!op || op.type!=='rename' || !['completed','running','rollback_failed','undo_failed'].includes(op.status))throw Error('该操作无法撤销或已撤销');
      if(!await confirm('确认恢复这次改名？','仅恢复文件名称。文件内容已更改、原位置被占用时将停止，不会覆盖现有文件。')) {store.addOperation({type:'undo',status:'canceled',parentId:op.id});return {canceled:true};}
      const undo=store.addOperation({type:'undo',status:'running',parentId:op.id});
      try {
        const restore=[];
        for(const item of op.items) {
          if(exists(item.source) && !exists(item.target)){same(item.source,item.snapshot);continue;}
          // A crash between link and unlink leaves two names for the same unchanged inode.
          if(exists(item.source) && exists(item.target)) {same(item.source,item.snapshot);same(item.target,item.snapshot);restore.push({...item,linkedOnly:true});continue;}
          if(exists(item.source) || !exists(item.target))throw Error('文件位置已变化，无法安全撤销');
          same(item.target,item.snapshot);restore.push(item);
        }
        for(const item of restore){same(item.target,item.snapshot);if(item.linkedOnly){same(item.source,item.snapshot);fs.unlinkSync(item.target);}else moveNoOverwrite(item.target,item.source);store.updateOperation(undo.id,{restored:(store.getOperation(undo.id).restored||0)+1});}
        store.updateOperation(op.id,{status:'undone'});store.updateOperation(undo.id,{status:'completed'});
        return {operationId:undo.id,status:'completed',undoneOperationId:op.id};
      }catch(error){store.updateOperation(op.id,{status:'undo_failed'});store.updateOperation(undo.id,{status:'failed',error:error.code||error.message});const failure=Error('未能完全撤销，请检查文件是否更改或被占用；操作记录已保留，可再次撤销。');failure.operationId=op.id;throw failure;}
    },
    async openOutput({ id } = {}) { const op=store.getOperation(id);if(!op || op.type!=='output' || op.status!=='completed')throw Error('只能打开本应用创建的输出文件');if(!OUTPUT_EXTENSIONS.has(path.extname(op.path).toLowerCase()))throw Error('禁止打开可执行或脚本输出文件');same(op.path,op.snapshot);const error=await shell.openPath(op.path);if(error)throw Error('无法打开输出文件，请检查关联应用');return {opened:true}; },
    notify({title='Momo',body=''} = {}) { if(typeof title!=='string'||typeof body!=='string')throw Error('通知内容无效');if(Notification.isSupported?.()===false)return {supported:false};new Notification({title:title.slice(0,100),body:body.slice(0,500)}).show();return {sent:true}; },
    readClipboard() {const text=clipboard.readText();if(Buffer.byteLength(text,'utf8')>LIMIT)throw Error('剪贴板内容超过 8 MB');return {text};},
    writeClipboard({text}={}) {if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>LIMIT)throw Error('剪贴板内容无效或过大');clipboard.writeText(text);return {written:true};},
  };
}
module.exports={createCapabilities};
