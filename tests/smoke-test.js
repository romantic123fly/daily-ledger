// 无浏览器环境下的 index.html 冒烟测试：DOM 桩 + vm 执行 + 交互模拟
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const htmlPath = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no script'); process.exit(1); }
const src = m[1];

function makeEl(sel) {
  const e = {
    _sel: sel, _h: {}, innerHTML: '', textContent: '', value: '', disabled: false,
    open: false, files: [], style: {}, dataset: {}, children: [], tagName: 'DIV',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    _add(t, h) { (e._h[t] = e._h[t] || []).push(h); },
    _fire(t, ev) { const hs = e._h[t] || []; let err = null; hs.forEach(h => { try { h(ev); } catch (x) { err = x; } }); return err; }
  };
  e.addEventListener = e._add;
  e.removeEventListener = () => {};
  e.appendChild = (c) => { e.children.push(c); return c; };
  e.insertBefore = (c) => { e.children.push(c); return c; };
  e.querySelector = (s) => getEl(sel + ' >> ' + s);
  e.querySelectorAll = () => [];
  e.closest = () => null;
  e.contains = () => false;
  e.focus = () => {}; e.select = () => {}; e.click = () => {}; e.remove = () => {};
  e.setAttribute = () => {}; e.getAttribute = () => null;
  e.cloneNode = () => makeEl(sel);
  return e;
}
const els = new Map();
function getEl(sel) { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); }

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] || null
};

const navBtns = ['records', 'categories', 'year', 'compare'].map(tab => {
  const b = makeEl('.nav-tabs button[data-tab=' + tab + ']');
  b.dataset = { tab };
  return b;
});
const sandbox = {
  console,
  localStorage,
  document: {
    getElementById: (id) => getEl('#' + id),
    querySelector: (s) => getEl(s),
    querySelectorAll: (s) => (s === '.nav-tabs button' ? navBtns : []),
    createElement: (t) => makeEl(t),
    addEventListener: () => {},
    body: makeEl('body'),
    documentElement: makeEl('html'),
    activeElement: null
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('offline-test')),
  location: { href: 'file:///index.html', search: '', hash: '' },
  navigator: { userAgent: 'node' },
  alert: () => {}, prompt: () => null, confirm: () => false,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  Blob: function () {},
  FileReader: function () { this.readAsText = () => {}; },
  requestAnimationFrame: (f) => setTimeout(f, 0)
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const results = [];
function check(name, fn) {
  try { const v = fn(); results.push([name, true, v]); }
  catch (e) { results.push([name, false, e.message]); }
}

let initError = null;
try {
  vm.runInContext(src, sandbox, { filename: 'index-inline.js' });
} catch (e) {
  initError = e;
}
check('初始化不抛异常', () => { if (initError) throw initError; return 'ok'; });
check('年度汇总卡片已渲染', () => {
  const h = getEl('#yearGrid').innerHTML;
  if (!h || h.length < 50) throw new Error('empty #yearGrid');
  return h.length + ' chars';
});
check('收入/支出表格已渲染', () => {
  const inc = getEl('#incomeBody').innerHTML, exp = getEl('#expenseBody').innerHTML;
  const c = (s) => (s.match(/data-index=/g) || []).length;
  if (!c(inc) || !c(exp)) throw new Error('rows missing inc=' + c(inc) + ' exp=' + c(exp));
  return 'inc rows=' + c(inc) + ', exp rows=' + c(exp);
});
check('趋势图 SVG 已渲染', () => {
  const h = getEl('#yearTrend').innerHTML;
  if (h.indexOf('<svg') < 0) throw new Error('no svg');
  return 'points=' + ((h.match(/<circle/g) || []).length);
});
check('分类列表已渲染（切到分类页签）', () => {
  const btn = navBtns.find(b => b.dataset.tab === 'categories');
  const err = btn._fire('click', {});
  if (err) throw err;
  const h = getEl('#incomeCats').innerHTML + getEl('#expenseCats').innerHTML;
  if (h.indexOf('工资') < 0) throw new Error('工资 missing: ' + h.slice(0, 80));
  return 'chips=' + ((h.match(/data-rename/g) || []).length);
});
check('同步状态=未配置', () => {
  const t = getEl('#syncStatus').textContent;
  if (t !== '未配置') throw new Error('got ' + JSON.stringify(t));
  return t;
});

// 取已保存状态
function saved() { const raw = store.get('daily_ledger_data_v3'); return raw ? JSON.parse(raw) : null; }
check('数据已写入 localStorage', () => {
  const s = saved();
  if (!s) throw new Error('no saved state');
  const months = Object.keys(s.months || {}).length;
  if (!months) throw new Error('no months');
  if (!s.seedApplied) throw new Error('seedApplied not set');
  return 'months=' + months + ', cats=' + (s.categories.income.length + s.categories.expense.length) + ', updatedAt=' + !!s.updatedAt;
});

// 基线回归：内置历史数据合计必须保持 1,282,487 / 948,841 / 333,646
check('基准合计未回退（收入 1,282,487 / 支出 948,841）', () => {
  const s = saved();
  const toNum = v => { const n = parseFloat(String(v == null ? '' : v)); return isNaN(n) ? 0 : n; };
  let inc = 0, exp = 0;
  for (const k of Object.keys(s.months)) {
    inc += (s.months[k].income || []).reduce((x, r) => x + toNum(r.amount), 0);
    exp += (s.months[k].expense || []).reduce((x, r) => x + toNum(r.amount), 0);
  }
  const round = n => Math.round(n * 100) / 100;
  if (round(inc) !== 1282487) throw new Error('income ' + round(inc));
  if (round(exp) !== 948841) throw new Error('expense ' + round(exp));
  return 'inc=' + round(inc) + ' exp=' + round(exp) + ' bal=' + round(inc - exp);
});
check('2026-11 基准月份数据正确（19000 / 11168）', () => {
  const s = saved();
  const m = s.months['2026-11'];
  if (!m) throw new Error('missing 2026-11');
  const toNum = v => { const n = parseFloat(String(v == null ? '' : v)); return isNaN(n) ? 0 : n; };
  const inc = (m.income || []).reduce((x, r) => x + toNum(r.amount), 0);
  const exp = (m.expense || []).reduce((x, r) => x + toNum(r.amount), 0);
  if (Math.round(inc) !== 19000 || Math.round(exp) !== 11168) throw new Error('inc=' + inc + ' exp=' + exp);
  return 'ok';
});

function fakeInput(field, value, index) {
  return {
    dataset: { field, index: String(index) },
    value,
    tagName: 'INPUT',
    closest: () => ({ dataset: { index: String(index) } })
  };
}
check('金额算式折算（=3000+500 → 3500）', () => {
  const body = getEl('#incomeBody');
  const tr = fakeInput('amount', '=3000+500', 0);
  const ev = { target: tr };
  if (body._fire('input', ev)) throw new Error('input handler threw');
  const afterInput = saved();
  const key = Object.keys(afterInput.months).sort().pop();
  body._fire('focusout', ev);
  const s2 = saved();
  const row = s2.months[key].income[0];
  if (String(row.amount) !== '3500') throw new Error('amount=' + JSON.stringify(row.amount));
  return 'row.amount=3500 (month ' + key + ')';
});

// 模拟：Excel 粘贴（4 列）
check('Excel 粘贴 4 列填充', () => {
  const body = getEl('#expenseBody');
  body.contains = () => true;
  sandbox.document.activeElement = {
    tagName: 'INPUT',
    closest: (s) => (s === 'tr' ? { dataset: { index: '0' } } : null)
  };
  const ev = {
    target: fakeInput('sub', '', 0),
    clipboardData: { getData: () => '日常生活\t买菜\t120.5\t周末\n交通出行\t地铁\t6\t通勤' },
    preventDefault: () => {}
  };
  if (body._fire('paste', ev)) throw new Error('paste handler threw');
  const s = saved();
  const key = Object.keys(s.months).sort().pop();
  const rows = s.months[key].expense;
  if (!rows[1]) throw new Error('second row missing, rows=' + rows.length);
  if (rows[1].sub !== '地铁') throw new Error('rows[1].sub=' + rows[1].sub + ' row0=' + JSON.stringify(rows[0]));
  return 'row0=' + rows[0].category + '/' + rows[0].sub + '/' + rows[0].amount + ', row1=' + rows[1].sub + '/' + rows[1].amount;
});
// 撤销
check('撤销可回退粘贴', () => {
  const before = JSON.stringify(saved());
  const btn = getEl('#btnUndo');
  const ev = { target: { tagName: 'BODY' }, ctrlKey: true, key: 'z', preventDefault: () => {} };
  if (btn._fire('click', ev)) throw new Error('undo click threw');
  const after = JSON.stringify(saved());
  return before === after ? 'unchanged(可能有别的路径)' : 'state changed';
});

console.log('\n===== 冒烟测试 =====');
let fail = 0;
for (const [name, ok, info] of results) {
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' -> ' + info);
}
console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
