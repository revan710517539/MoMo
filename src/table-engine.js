/** Browser-safe CSV helpers. All input validation happens before comparison. */
export function parseCSV(input) {
  if (typeof input !== 'string') throw new Error('请提供 CSV 文本');
  const text = input.replace(/^\uFEFF/, '');
  const records = [];
  let row = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
      continue;
    }
    if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') {
      pushRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"') {
      if (cell !== '' || closed) throw new Error(`第 ${records.length + 1} 行的引号格式有误`);
      quoted = true;
    } else {
      if (closed) throw new Error(`第 ${records.length + 1} 行的引号后存在多余内容`);
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号');
  if (cell !== '' || row.length || closed) pushRow();
  if (!records.length) throw new Error('CSV 为空，请提供表头和数据');
  const headers = records.shift().map(value => value.trim());
  if (headers.some(value => !value)) throw new Error('表头不能为空');
  if (new Set(headers).size !== headers.length) throw new Error('表头有重复字段，请先修改');
  return records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`第 ${index + 2} 行有 ${values.length} 列，与表头的 ${headers.length} 列不一致`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}

function numericAmount(value, label) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new Error(`${label}的金额为空或无效`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error(`${label}的金额无效：${String(value)}`);
  return amount;
}

export function compareTables(oldRows, newRows, keyField, amountField = '') {
  if (!Array.isArray(oldRows) || !Array.isArray(newRows)) throw new Error('请提供两份表格数据');
  if (typeof keyField !== 'string' || !keyField.trim()) throw new Error('请选择匹配字段');
  const prepare = (rows, label) => {
    const map = new Map();
    let sum = 0;
    rows.forEach((row, index) => {
      const location = `${label}第 ${index + 2} 行`;
      if (!row || typeof row !== 'object' || !Object.hasOwn(row, keyField)) throw new Error(`${location}缺少匹配字段「${keyField}」`);
      const key = String(row[keyField] ?? '').trim();
      if (!key) throw new Error(`${location}的匹配值为空`);
      if (map.has(key)) throw new Error(`${label}的匹配值「${key}」重复，请先处理重复记录`);
      if (amountField) {
        if (!Object.hasOwn(row, amountField)) throw new Error(`${location}缺少金额字段「${amountField}」`);
        sum += numericAmount(row[amountField], location);
      }
      map.set(key, row);
    });
    return { map, sum };
  };
  const previous = prepare(oldRows, '原表'), current = prepare(newRows, '新表');
  const added = [], removed = [], changed = [], unchanged = [];
  for (const [key, after] of current.map) {
    if (!previous.map.has(key)) { added.push(after); continue; }
    const before = previous.map.get(key);
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(field => {
      if (field === keyField) return false;
      if (amountField && field === amountField) return numericAmount(before[field], '原表') !== numericAmount(after[field], '新表');
      return Object.hasOwn(before, field) !== Object.hasOwn(after, field) || String(before[field] ?? '') !== String(after[field] ?? '');
    });
    if (fields.length) changed.push({ key, before, after, fields, amountDelta: amountField ? numericAmount(after[amountField], '新表') - numericAmount(before[amountField], '原表') : null });
    else unchanged.push(after);
  }
  for (const [key, row] of previous.map) if (!current.map.has(key)) removed.push(row);
  const delta = current.sum - previous.sum;
  return {
    added, removed, changed, unchanged,
    counts: { added: added.length, removed: removed.length, changed: changed.length, unchanged: unchanged.length, before: oldRows.length, after: newRows.length },
    totals: { before: previous.sum, after: current.sum, delta },
    beforeSum: previous.sum, afterSum: current.sum, delta,
  };
}

export function toCSV(rows, columns) {
  if (!Array.isArray(rows)) throw new Error('请提供需要导出的数据');
  const headers = columns ?? [...new Set(rows.flatMap(row => Object.keys(row)))];
  const escape = value => {
    let cell = value == null ? '' : String(value);
    // User-controlled strings must not become spreadsheet formulas. Numeric values remain numeric.
    if (typeof value === 'string' && (/^[=+\-@\t\r\n]/.test(cell) || /^\s+[=+\-@]/.test(cell))) cell = `'${cell}`;
    return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  };
  return '\uFEFF' + [headers.map(escape).join(','), ...rows.map(row => headers.map(header => escape(row[header])).join(','))].join('\r\n');
}
