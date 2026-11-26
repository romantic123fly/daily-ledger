// 主题（外观 + 配色）测试：预置 localStorage / 点击按钮后验证 <html> 上的 data-theme、data-accent 与保存结果
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
    _sel: sel, _h: {}, innerHTML: '', textContent: '', value: '', disabled: false,
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
  e.setAttribute = (k, v) => { if (k.indexOf('data-') === 0) e.dataset[k.slice(5)] = String(v); };
  e.getAttribute = () => null;
  e.cloneNode = () => makeEl(sel);
  return e;
}

function runCase(themeJson, opts) {
  opts = opts || {};
  const els = new Map();
  function getEl(sel) { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); }
  const store = new Map();
  if (themeJson !== undefined) store.set('ledger_theme', themeJson);
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
  const modeBtns = ['auto', 'light', 'dark'].map(mode => {
    const b = makeEl('#themeModes button[data-mode=' + mode + ']');
    b.dataset = { mode };
    return b;
  });
  const accentBtns = ['blue', 'green', 'orange', 'purple', 'rose', 'slate'].map(accent => {
    const b = makeEl('#themeAccents button[data-accent=' + accent + ']');
    b.dataset = { accent };
    return b;
  });
  const htmlEl = makeEl('html');
  const sandbox = {
    console,
    localStorage,
    document: {
      getElementById: (id) => getEl('#' + id),
      querySelector: (s) => getEl(s),
      querySelectorAll: (s) => {
        if (s === '.nav-tabs button') return navBtns;
        if (s === '#themeModes button') return modeBtns;
        if (s === '#themeAccents button') return accentBtns;
        return [];
      },
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
  if (opts.matchMedia) sandbox.matchMedia = opts.matchMedia;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'index-inline.js' });
  return {
    ds: htmlEl.dataset,
    store,
    savedTheme: () => {
      const raw = store.get('ledger_theme');
      return raw ? JSON.parse(raw) : null;
    },
    clickMode: (mode) => {
      const b = modeBtns.find(x => x.dataset.mode === mode);
      if (!b) throw new Error('no mode button ' + mode);
      return b._fire('click', {});
    },
    clickAccent: (accent) => {
      const b = accentBtns.find(x => x.dataset.accent === accent);
      if (!b) throw new Error('no accent button ' + accent);
      return b._fire('click', {});
    },
    activeModes: () => modeBtns.filter(b => b.classList.contains('active')).map(b => b.dataset.mode),
    activeAccents: () => accentBtns.filter(b => b.classList.contains('active')).map(b => b.dataset.accent)
  };
}

const results = [];
function check(name, fn) {
  try { const v = fn(); results.push([name, true, v]); }
  catch (e) { results.push([name, false, e.message]); }
}

check('默认（无偏好）→ light + blue，auto 高亮', () => {
  const r = runCase(undefined, {});
  if (r.ds.theme !== 'light') throw new Error('theme=' + r.ds.theme);
  if (r.ds.accent !== 'blue') throw new Error('accent=' + r.ds.accent);
  if (r.activeModes().join() !== 'auto') throw new Error('activeModes=' + r.activeModes().join());
  if (r.activeAccents().join() !== 'blue') throw new Error('activeAccents=' + r.activeAccents().join());
  return 'light/blue';
});

check('auto + 系统深色 → dark/rose', () => {
  const r = runCase(JSON.stringify({ mode: 'auto', accent: 'rose' }), {
    matchMedia: () => ({ matches: true, addEventListener: () => {} })
  });
  if (r.ds.theme !== 'dark') throw new Error('theme=' + r.ds.theme);
  if (r.ds.accent !== 'rose') throw new Error('accent=' + r.ds.accent);
  return 'dark/rose';
});

check('手动浅色优先于系统深色 → light/green', () => {
  const r = runCase(JSON.stringify({ mode: 'light', accent: 'green' }), {
    matchMedia: () => ({ matches: true, addEventListener: () => {} })
  });
  if (r.ds.theme !== 'light') throw new Error('theme=' + r.ds.theme);
  if (r.ds.accent !== 'green') throw new Error('accent=' + r.ds.accent);
  return 'light/green';
});

check('非法配置回落 → auto(light) + blue', () => {
  const r = runCase(JSON.stringify({ mode: 'neon', accent: 'hotpink' }), {});
  if (r.ds.theme !== 'light') throw new Error('theme=' + r.ds.theme);
  if (r.ds.accent !== 'blue') throw new Error('accent=' + r.ds.accent);
  return 'light/blue';
});

check('点「深色」→ 立即 dark 且写入 localStorage', () => {
  const r = runCase(undefined, {});
  if (r.clickMode('dark')) throw new Error('click handler threw');
  if (r.ds.theme !== 'dark') throw new Error('theme=' + r.ds.theme);
  const saved = r.savedTheme();
  if (!saved || saved.mode !== 'dark') throw new Error('saved=' + JSON.stringify(saved));
  if (r.activeModes().join() !== 'dark') throw new Error('activeModes=' + r.activeModes().join());
  return 'dark, saved.mode=dark';
});

check('点「紫色」→ accent=purple 且保存', () => {
  const r = runCase(undefined, {});
  if (r.clickAccent('purple')) throw new Error('click handler threw');
  if (r.ds.accent !== 'purple') throw new Error('accent=' + r.ds.accent);
  const saved = r.savedTheme();
  if (!saved || saved.accent !== 'purple') throw new Error('saved=' + JSON.stringify(saved));
  if (r.activeAccents().join() !== 'purple') throw new Error('activeAccents=' + r.activeAccents().join());
  return 'purple, saved.accent=purple';
});

check('切换后刷新（新实例读回偏好）保持设置', () => {
  const first = runCase(undefined, {});
  first.clickMode('dark');
  first.clickAccent('orange');
  const raw = first.store.get('ledger_theme');
  const second = runCase(raw, {});
  if (second.ds.theme !== 'dark') throw new Error('theme=' + second.ds.theme);
  if (second.ds.accent !== 'orange') throw new Error('accent=' + second.ds.accent);
  return 'dark/orange 保持';
});

let failed = 0;
for (const [name, ok, info] of results) {
  if (!ok) failed++;
  console.log((ok ? '✓ ' : '✗ ') + name + ' — ' + info);
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
