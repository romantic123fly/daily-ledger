// 隐私模式（隐藏/显示汇总数字）测试：验证 <html> 上的 data-privacy 切换与 localStorage 持久化
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
    label: () => getEl('#privacyText').textContent,
    icon: () => getEl('#privacyIcon').textContent
  };
}

const results = [];
function check(name, fn) {
  try { const v = fn(); results.push([name, true, v]); }
  catch (e) { results.push([name, false, e.message]); }
}

check('默认关闭：data-privacy=0，按钮文案「隐藏总数」', () => {
  const r = runCase(undefined);
  if (r.ds.privacy !== '0') throw new Error('data-privacy=' + r.ds.privacy);
  if (r.btn.getAttribute('aria-pressed') !== 'false') throw new Error('aria-pressed=' + r.btn.getAttribute('aria-pressed'));
  if (r.label() !== '隐藏总数') throw new Error('label=' + r.label());
  if (r.icon() !== '👁') throw new Error('icon=' + r.icon());
  return 'off';
});

check('点一下 → 开启并写入 localStorage', () => {
  const r = runCase(undefined);
  if (r.click()) throw new Error('click handler threw');
  if (r.ds.privacy !== '1') throw new Error('data-privacy=' + r.ds.privacy);
  if (r.btn.getAttribute('aria-pressed') !== 'true') throw new Error('aria-pressed=' + r.btn.getAttribute('aria-pressed'));
  if (r.store.get('ledger_privacy') !== '1') throw new Error('saved=' + r.store.get('ledger_privacy'));
  if (r.label() !== '显示总数') throw new Error('label=' + r.label());
  if (r.icon() !== '🙈') throw new Error('icon=' + r.icon());
  return 'on';
});

check('再点一下 → 关闭并保存 0', () => {
  const r = runCase('1');
  if (r.click()) throw new Error('click handler threw');
  if (r.ds.privacy !== '0') throw new Error('data-privacy=' + r.ds.privacy);
  if (r.store.get('ledger_privacy') !== '0') throw new Error('saved=' + r.store.get('ledger_privacy'));
  return 'off again';
});

check('刷新后保持隐藏状态', () => {
  const r = runCase('1');
  if (r.ds.privacy !== '1') throw new Error('data-privacy=' + r.ds.privacy);
  if (r.label() !== '显示总数') throw new Error('label=' + r.label());
  return 'restored on';
});

check('页面元素齐全：切换按钮 + 图标 + 文案', () => {
  const r = runCase(undefined);
  if (!r.btn) throw new Error('missing #btnPrivacy');
  if (!r.label()) throw new Error('missing #privacyText');
  if (!r.icon()) throw new Error('missing #privacyIcon');
  return 'ok';
});

check('打码覆盖余额输入框（计划余额 / 实际余额）', () => {
  if (html.indexOf('id="actualBalance"') < 0) throw new Error('missing #actualBalance');
  if (html.indexOf('id="planBalance"') < 0) throw new Error('missing #planBalance');
  if (html.indexOf('[data-privacy="1"] .balance-item input') < 0) throw new Error('missing balance blur rule');
  if (html.indexOf('[data-privacy="1"] .balance-item input:focus') < 0) throw new Error('missing balance focus rule');
  return 'balance inputs covered';
});

let failed = 0;
for (const [name, ok, info] of results) {
  if (!ok) failed++;
  console.log((ok ? '✓ ' : '✗ ') + name + ' — ' + info);
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
