// 隐私模式（隐藏/显示汇总数字）测试：
// 开启后数字应被替换成眼睛图标（不再用 CSS 模糊），且状态持久化到 localStorage
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const htmlPath = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
const src = scripts.find(s => s.indexOf('STORAGE_KEY') >= 0);
if (!src) { console.error('no app script'); process.exit(1); }

function makeEl(sel) {
  const e = {
    _sel: sel, _h: {}, _attrs: {}, innerHTML: '', textContent: '', value: '', disabled: false,
    open: false, files: [], style: {}, dataset: {}, children: [], tagName: 'DIV',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    _add(t, h) { (e._h[t] = e._h[t] || []).push(h); },
    _fire(t, ev) { const hs = (e._h[t] || []).slice(); let err = null; hs.forEach(h => { try { h(ev); } catch (x) { err = x; } }); return err; }
  };
  e.addEventListener = e._add;
  e.removeEventListener = () => {};
  e.appendChild = (c) => { e.children.push(c); return c; };
  e.insertBefore = (c) => { e.children.push(c); return c; };
  e.querySelector = () => null;
  e.querySelectorAll = () => [];
  e.closest = () => null;
  e.contains = () => false;
  e.focus = () => {}; e.select = () => {}; e.click = () => {}; e.remove = () => {};
  e.setAttribute = (k, v) => {
    e._attrs[k] = String(v);
    if (k.indexOf('data-') === 0) e.dataset[k.slice(5)] = String(v);
  };
  e.getAttribute = (k) => (k in e._attrs ? e._attrs[k] : null);
  e.cloneNode = () => makeEl(sel);
  return e;
}

function runCase(privacyStored) {
  const els = new Map();
  function getEl(sel) { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); }
  const store = new Map();
  if (privacyStored !== undefined) store.set('ledger_privacy', privacyStored);
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
  const htmlEl = makeEl('html');
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
      documentElement: htmlEl,
      activeElement: null
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => Promise.reject(new Error('offline-test')),
    location: { href: 'file:///index.html', search: '', hash: '' },
    navigator: { userAgent: 'node' },
    alert: () => {}, prompt: () => null, confirm: () => false,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: function () {}, FileReader: function () { this.readAsText = () => {}; },
    requestAnimationFrame: (f) => setTimeout(f, 0)
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'index-inline.js' });
  const btn = getEl('#btnPrivacy');
  return {
    ds: htmlEl.dataset,
    store,
    click: () => btn._fire('click', {}),
    btn,
    text: (sel) => getEl(sel).textContent,
    html: (sel) => getEl(sel).innerHTML,
    el: (sel) => getEl(sel)
  };
}

const EYE = '👁';
const results = [];
function check(name, fn) {
  try { const v = fn(); results.push([name, true, v]); }
  catch (e) { results.push([name, false, e.message]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

check('默认显示真实数字（data-privacy=0，按钮文案「隐藏总数」）', () => {
  const r = runCase(undefined);
  assert(r.ds.privacy === '0', 'data-privacy=' + r.ds.privacy);
  assert(r.btn.getAttribute('aria-pressed') === 'false', 'aria-pressed=' + r.btn.getAttribute('aria-pressed'));
  assert(r.text('#privacyText') === '隐藏总数', 'label=' + r.text('#privacyText'));
  assert(r.text('#privacyIcon') === '👁', 'icon=' + r.text('#privacyIcon'));
  assert(r.text('#sumIncome').indexOf('¥') === 0, 'sumIncome=' + r.text('#sumIncome'));
  return r.text('#sumIncome');
});

check('点一下 → 数字换成眼睛图标并写入 localStorage', () => {
  const r = runCase(undefined);
  if (r.click()) throw new Error('click handler threw');
  assert(r.ds.privacy === '1', 'data-privacy=' + r.ds.privacy);
  assert(r.store.get('ledger_privacy') === '1', 'saved=' + r.store.get('ledger_privacy'));
  assert(r.btn.getAttribute('aria-pressed') === 'true', 'aria-pressed');
  assert(r.text('#privacyText') === '显示总数', 'label=' + r.text('#privacyText'));
  assert(r.text('#privacyIcon') === '🙈', 'icon=' + r.text('#privacyIcon'));
  assert(r.text('#sumIncome') === EYE, 'sumIncome=' + r.text('#sumIncome'));
  assert(r.text('#sumExpense') === EYE, 'sumExpense=' + r.text('#sumExpense'));
  assert(r.text('#sumBalance') === EYE, 'sumBalance=' + r.text('#sumBalance'));
  assert(r.text('#sumDeviation') === EYE, 'sumDeviation=' + r.text('#sumDeviation'));
  return 'masked';
});

check('年度汇总 / 年度对比 / 趋势图刻度也一起隐藏', () => {
  const r = runCase('1');
  assert(r.html('#yearGrid').indexOf(EYE) >= 0, 'yearGrid 未打码');
  assert(r.html('#yearGrid').indexOf('¥') < 0, 'yearGrid 仍有金额');
  assert(r.html('#yearTotals').indexOf(EYE) >= 0, 'yearTotals 未打码');
  assert(r.html('#compareTable').indexOf(EYE) >= 0, 'compareTable 未打码');
  assert(r.html('#yearBreakdown').indexOf(EYE) >= 0, 'yearBreakdown 未打码');
  assert(r.html('#yearTrend').indexOf('万') < 0, '趋势图 Y 轴刻度没隐藏');
  return 'year/compare/trend masked';
});

check('再点一下 → 恢复真实数字并保存 0', () => {
  const r = runCase('1');
  if (r.click()) throw new Error('click handler threw');
  assert(r.ds.privacy === '0', 'data-privacy=' + r.ds.privacy);
  assert(r.store.get('ledger_privacy') === '0', 'saved=' + r.store.get('ledger_privacy'));
  assert(r.text('#sumIncome').indexOf('¥') === 0, 'sumIncome=' + r.text('#sumIncome'));
  assert(r.html('#yearGrid').indexOf(EYE) < 0, 'yearGrid 仍显示眼睛');
  return r.text('#sumIncome');
});

check('刷新后保持隐藏状态', () => {
  const r = runCase('1');
  assert(r.ds.privacy === '1', 'data-privacy=' + r.ds.privacy);
  assert(r.text('#privacyText') === '显示总数', 'label=' + r.text('#privacyText'));
  assert(r.text('#sumIncome') === EYE, 'sumIncome=' + r.text('#sumIncome'));
  return 'restored on';
});

check('页面元素齐全 + 余额输入框用眼睛遮罩', () => {
  const r = runCase(undefined);
  assert(r.btn, 'missing #btnPrivacy');
  assert(html.indexOf('id="actualBalance"') >= 0, 'missing #actualBalance');
  assert(html.indexOf('id="planBalance"') >= 0, 'missing #planBalance');
  assert(html.indexOf('class="bal-field"') >= 0, 'missing .bal-field wrapper');
  assert(html.indexOf('.bal-field::after') >= 0, 'missing .bal-field::after mask');
  assert(html.indexOf('[data-privacy="1"] .bal-field::after') >= 0, 'missing privacy mask rule');
  return 'ok';
});

let failed = 0;
for (const [name, ok, info] of results) {
  if (!ok) failed++;
  console.log((ok ? '✓ ' : '✗ ') + name + ' — ' + info);
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
