import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, compareTables, toCSV } from '../src/table-engine.js';

test('CSV supports BOM, CRLF, quoted commas, newlines and escaped quotes', () => {
  assert.deepEqual(parseCSV('\uFEFF编号,备注\r\n1,"含逗号,和""引号"""\r\n2,"第一行\n第二行"\r\n'), [
    { 编号: '1', 备注: '含逗号,和"引号"' }, { 编号: '2', 备注: '第一行\n第二行' },
  ]);
});

test('malformed CSV fails before processing', () => {
  for (const input of ['', 'a,a\n1,2', 'a,\n1,2', 'a,b\n1', 'a\n"open', 'a\nx"y', 'a\n"x"oops']) {
    assert.throws(() => parseCSV(input));
  }
});

test('comparison distinguishes additions, removals, numeric equality and changed fields', () => {
  const oldRows = [{ id: 'a', amount: '0', name: '甲' }, { id: 'b', amount: '12', name: '乙' }, { id: 'c', amount: '3', name: '丙' }];
  const newRows = [{ id: 'a', amount: '0.00', name: '甲' }, { id: 'b', amount: '15', name: '新乙' }, { id: 'd', amount: '7', name: '丁' }];
  const result = compareTables(oldRows, newRows, 'id', 'amount');
  assert.deepEqual(result.counts, { added: 1, removed: 1, changed: 1, unchanged: 1, before: 3, after: 3 });
  assert.deepEqual(result.changed[0].fields, ['amount', 'name']);
  assert.equal(result.changed[0].amountDelta, 3);
  assert.deepEqual(result.totals, { before: 15, after: 22, delta: 7 });
  assert.equal(result.added[0].id, 'd');
  assert.equal(result.removed[0].id, 'c');
});

test('duplicate, missing and blank keys and invalid amounts are rejected in either input', () => {
  const cases = [[{}], [{ id: '' }], [{ id: 'a' }, { id: ' a ' }], [{ id: 'a', amount: '' }], [{ id: 'a', amount: 'oops' }], [{ id: 'a', amount: Infinity }]];
  for (const rows of cases) {
    assert.throws(() => compareTables(rows, [], 'id', 'amount'));
    assert.throws(() => compareTables([], rows, 'id', 'amount'));
  }
});

test('non-amount changes and empty tables are supported', () => {
  assert.deepEqual(compareTables([], [], 'id').counts, { added: 0, removed: 0, changed: 0, unchanged: 0, before: 0, after: 0 });
  assert.equal(compareTables([{ id: '0', text: 'x' }], [{ id: '0', text: 'y' }], 'id').changed.length, 1);
});

test('CSV export escapes content and neutralizes formulas without changing numeric values', () => {
  const output = toCSV([{ name: '=SUM(A1)', amount: -12, note: 'a,"b"\nc' }, { name: ' +CMD', amount: 0, note: '@evil' }], ['name', 'amount', 'note']);
  assert.ok(output.startsWith('\uFEFF'));
  assert.deepEqual(parseCSV(output), [
    { name: "'=SUM(A1)", amount: '-12', note: 'a,"b"\nc' }, { name: "' +CMD", amount: '0', note: "'@evil" },
  ]);
  for (const value of ['+a', '-a', '@a', '\tfoo', '\rfoo']) assert.ok(toCSV([{ value }]).includes("'"));
});
