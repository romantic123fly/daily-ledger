// 语法自检：提取 index.html 里的应用脚本，写入临时文件后用 node --check 校验
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const htmlPath = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
const app = scripts.find(s => s.indexOf('STORAGE_KEY') >= 0);
if (!app) { console.error('找不到应用脚本（含 STORAGE_KEY 的内联 <script>）'); process.exit(1); }

const tmp = path.join(os.tmpdir(), 'ledger-app-' + process.pid + '.mjs');
fs.writeFileSync(tmp, app);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'inherit' });
  console.log(`语法检查通过（html ${html.split('\n').length} 行 / 脚本 ${app.length} 字符 / 内联脚本 ${scripts.length} 段）`);
} finally {
  try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }
}
