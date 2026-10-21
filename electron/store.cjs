const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createStore(userData) {
  fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(userData, 'momo.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS tools(id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, json TEXT NOT NULL);`);
  fs.chmodSync(path.join(userData, 'momo.sqlite'), 0o600);
  const parse = r => r ? JSON.parse(r.json) : null;
  const list = table => db.prepare(`SELECT json FROM ${table} ORDER BY rowid DESC`).all().map(parse);
  const get = (table, id) => parse(db.prepare(`SELECT json FROM ${table} WHERE id=?`).get(id));
  const put = (table, value) => { db.prepare(`INSERT INTO ${table}(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json`).run(value.id, JSON.stringify(value)); return value; };
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  function saveTool(tool) {
    if (!tool || !['compare','rename','calculator','custom'].includes(tool.kind) || typeof tool.title !== 'string' || !tool.title.trim()) throw Error('工具名称和类型无效');
    return tx(() => {
      const id = tool.id || randomUUID();
      const previous = get('tools', id);
      const latest = db.prepare('SELECT MAX(version) AS version FROM versions WHERE id=?').get(id).version || 0;
      const snapshot = { ...tool, id, title: tool.title.trim(), version: latest + 1, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      db.prepare('INSERT INTO versions(id,version,json) VALUES(?,?,?)').run(id, snapshot.version, JSON.stringify(snapshot));
      return put('tools', snapshot);
    });
  }
  // Preserve interrupted work as evidence; never silently restart filesystem or model actions.
  for (const task of list('tasks')) if (task.status === 'running') put('tasks', { ...task, status: 'interrupted', updatedAt: new Date().toISOString() });
  const canRecover = op => op?.type === 'rename' && ['completed','running','rollback_failed','undo_failed'].includes(op.status);
  // The operation journal is authoritative even if a crash happened before the UI task was saved.
  for (const op of list('operations').filter(op => op.type === 'rename')) {
    const related = list('tasks').filter(task => task.operationId === op.id);
    if (canRecover(op)) {
      const status = op.status === 'completed' ? 'completed' : op.status === 'running' ? 'interrupted' : 'failed';
      if (!related.length) put('tasks', { id:`recovery:${op.id}`, type:'native', title:op.status === 'completed' ? '文件批量改名' : '文件改名待恢复', status, operationId:op.id, recoverable:true, createdAt:op.createdAt, updatedAt:new Date().toISOString() });
      else for (const task of related) put('tasks', { ...task, status, recoverable:true });
    } else if(op.status === 'undone') for (const task of related) put('tasks', { ...task, status:'undone', recoverable:false });
  }
  const getSettings = () => parse(db.prepare('SELECT json FROM settings WHERE id=1').get()) || {};
  const hasPlainCredential = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) => /^(apiKey|token|secret|password)$/i.test(key) || hasPlainCredential(child));
  return {
    listTools: () => list('tools'), saveTool,
    listArchivedTools: () => db.prepare(`SELECT v.json FROM versions v
      INNER JOIN (SELECT id, MAX(version) AS version FROM versions GROUP BY id) latest
      ON v.id=latest.id AND v.version=latest.version
      WHERE NOT EXISTS (SELECT 1 FROM tools t WHERE t.id=v.id)`).all().map(parse)
      .sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.id.localeCompare(b.id)),
    deleteTool: id => tx(() => { db.prepare('DELETE FROM tools WHERE id=?').run(id); return { id, deleted: true }; }),
    listVersions: id => db.prepare('SELECT json FROM versions WHERE id=? ORDER BY version DESC').all(id).map(parse),
    restoreVersion({ id, version }) { const snapshot = parse(db.prepare('SELECT json FROM versions WHERE id=? AND version=?').get(id, version)); if (!snapshot) throw Error('找不到工具版本'); return saveTool(snapshot); },
    getSettings,
    saveSettings(settings) { if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('设置无效'); if (hasPlainCredential(settings)) throw Error('凭据必须先由宿主加密'); const value = { ...getSettings(), ...settings }; db.prepare('INSERT INTO settings(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(JSON.stringify(value)); return value; },
    listTasks: () => list('tasks'),
    saveTask: task => { if (!task || typeof task !== 'object') throw Error('任务无效'); const previous=task.id?get('tasks',task.id):null;const value={...previous,...task,id:task.id||randomUUID(),createdAt:previous?.createdAt||task.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};if(value.operationId)value.recoverable=canRecover(get('operations',value.operationId));return put('tasks',value); },
    addOperation: op => put('operations', { ...op, id: randomUUID(), createdAt: new Date().toISOString() }),
    getOperation: id => get('operations', id),
    updateOperation(id, patch) { const op = get('operations', id); if (!op) throw Error('找不到操作记录'); const value=put('operations', { ...op, ...patch, id, updatedAt: new Date().toISOString() });if(value.type==='rename')for(const task of list('tasks').filter(t=>t.operationId===id))put('tasks',{...task,recoverable:canRecover(value),...(value.status==='undone'?{status:'undone'}:{})});return value; },
    close: () => db.close(),
  };
}
module.exports = { createStore };
