// 场景测试：老数据迁移 与 删除月份不复活
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const STORAGE_KEY = 'daily_ledger_data_v3';

function makeEl(sel) {
  const e = {
    _sel: sel, _h: {}, innerHTML: '', textContent: '', value: '', disabled: false,
    open: false, files: [], style: {}, dataset: {}, children: [], tagName: 'DIV',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(t, h) { (e._h[t] = e._h[t] || []).push(h); },
    removeEventListener() {},
    appendChild(c) { e.children.push(c); return c; },
    insertBefore(c) { e.children.push(c); return c; },
    querySelector(s) { return getEl(sel + ' >> ' + s); },
    querySelectorAll() { return []; },
    closest() { return null; }, contains() { return false; },
    focus() {}, select() {}, click() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; }, cloneNode() { return makeEl(sel); }
  };
  return e;
}
let els = new Map();
function getEl(sel) { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); }

function run(initial, opts) {
  els = new Map();
  const navBtns = ['records', 'categories', 'year', 'compare'].map(tab => {
    const b = makeEl('nav-' + tab);
    b.dataset = { tab };
    return b;
  });
  const store = new Map(Object.entries(initial || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; }
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    localStorage,
    document: {
      getElementById: id => getEl('#' + id),
      querySelector: s => getEl(s),
      querySelectorAll: s => (s === '.nav-tabs button' ? navBtns : []),
      createElement: t => makeEl(t),
      addEventListener() {},
      body: makeEl('body'), documentElement: makeEl('html'), activeElement: null
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => Promise.reject(new Error('offline')),
    location: { href: 'file:///index.html', search: '', hash: '' },
    navigator: { userAgent: 'node' },
    alert() {}, prompt() { return null; }, confirm() { return false; },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: function () {},
    FileReader: function () { this.readAsText = () => {}; },
    requestAnimationFrame: f => setTimeout(f, 0)
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  let err = null;
  try { vm.runInContext(src, sandbox, { filename: 'inline.js' }); } catch (e) { err = e; }
  const savedRaw = store.get(STORAGE_KEY);
  return { err, state: savedRaw ? JSON.parse(savedRaw) : null, els, store };
}

const results = [];
function check(name, fn) {
  try { results.push([name, true, fn()]); } catch (e) { results.push([name, false, e.message]); }
}

// 场景 1：老版本 localStorage（无 seedApplied，只有 2026-11 一个月）
const oldState = {
  categories: { income: ['工资', '其他收入'], expense: ['日常生活', '住房'] },
  months: {
    '2026-11': {
      income: [{ category: '工资', sub: '自定义奖金', amount: '25000', note: '手工录入' }],
      expense: [{ category: '日常生活', sub: '外卖', amount: '88', note: '' }],
      planBalance: '', actualBalance: ''
    }
  }
};
const r1 = run({ [STORAGE_KEY]: oldState });
check('老数据迁移不报错', () => { if (r1.err) throw r1.err; return 'ok'; });
check('迁移后仍保留全部历史月份', () => {
  const n = Object.keys(r1.state.months).length;
  if (n < 48) throw new Error('months=' + n);
  return 'months=' + n;
});
check('迁移后本地编辑过的月份被保留（2026-11 = 25000/88）', () => {
  const m = r1.state.months['2026-11'];
  const inc = m.income.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
  const exp = m.expense.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
  if (Math.round(inc) !== 25000) throw new Error('inc=' + inc);
  if (Math.round(exp) !== 88) throw new Error('exp=' + exp);
  if (m.income[0].sub !== '自定义奖金') throw new Error('sub=' + m.income[0].sub);
  return 'inc=' + inc + ' exp=' + exp;
});
check('迁移后 seedApplied=true', () => { if (!r1.state.seedApplied) throw new Error('no flag'); return 'ok'; });
check('迁移后分类取并集（保留自定义项）', () => {
  const inc = r1.state.categories.income.join(',');
  if (inc.indexOf('工资') < 0 || inc.indexOf('其他收入') < 0) throw new Error(inc);
  return inc;
});

// 场景 2：已迁移数据 + 删除过 2024-03 → 内置 SEED 不能把它复活
const migrated = JSON.parse(JSON.stringify(r1.state));
delete migrated.months['2024-03'];
migrated.deletedMonths = { '2024-03': Date.now() };
const r2 = run({ [STORAGE_KEY]: migrated });
check('删除的月份不会被 SEED 复活', () => {
  if (r2.err) throw r2.err;
  if (r2.state.months['2024-03']) throw new Error('2024-03 复活了');
  const n = Object.keys(r2.state.months).length;
  if (n !== 47) throw new Error('months=' + n);
  return 'months=' + n + '（2024-03 已删）';
});
check('其它月份数据完整（2024-04 存在）', () => {
  const m = r2.state.months['2024-04'];
  if (!m) throw new Error('missing 2024-04');
  return 'inc rows=' + m.income.length + ' exp rows=' + m.expense.length;
});

// 场景 3：全新用户（无 localStorage）→ 48 个月 + 已持久化
const r3 = run({});
check('新用户首开即持久化 SEED（48 个月）', () => {
  if (r3.err) throw r3.err;
  const n = Object.keys(r3.state.months).length;
  if (n !== 48) throw new Error('months=' + n);
  return 'months=' + n;
});

console.log('\n===== 迁移/回归场景测试 =====');
let fail = 0;
for (const [name, ok, info] of results) { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' -> ' + info); }
console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
