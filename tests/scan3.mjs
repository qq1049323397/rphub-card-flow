import { loadCard } from '../scripts/rphub-card.mjs';
import fs from 'node:fs'; import path from 'node:path';
function* walk(d, depth = 0) {
  if (depth > 4) return;
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (/\.(png|json)$/i.test(e.name)) yield p;
  }
}
// 扫描目录从命令行给，脚本内不写死 —— 这个包要能发给别人。
const DIR = process.argv[2];
if (!DIR) {
  console.error('用法: node tests/scan3.mjs <要扫描的目录>');
  process.exit(2);
}
const seen = new Set(); const unguarded = [];
let cards = 0, scripts = 0, guarded = 0;
for (const p of walk(DIR)) {
  let card; try { ({ card } = loadCard(p)); } catch { continue; }
  const d = card.data || card;
  const list = card.extensions?.regex_scripts || d.extensions?.regex_scripts || d.regex_scripts || [];
  if (!Array.isArray(list) || !list.length) continue;
  const nm = (d.name || '') + '|' + list.length;
  cards++;
  for (const s of list) {
    const re = String(s.regex || s.findRegex || '');
    const repl = String(s.replacement ?? s.replaceString ?? '');
    if (!re) continue; scripts++;
    if (!/<!DOCTYPE|<\?xml|<html/i.test(re)) continue;
    if (!/^\^/.test(re.trim())) continue;
    if (!/<(div|section|article|span|p)\b/i.test(repl) || !/\$1/.test(repl)) continue;
    const hasGuard = /\(\?!/.test(re);
    if (hasGuard) { guarded++; continue; }
    const zeroLen = /\[\\s\\S\]\*\?/.test(re);
    const key = re.slice(0, 60);
    if (seen.has(nm + key)) continue;
    seen.add(nm + key);
    unguarded.push({ file: path.basename(p), name: s.name || s.scriptName, re, repl: repl.slice(0, 55), zeroLen });
  }
}
console.log(`扫描 ${cards} 张带正则的卡 / ${scripts} 条正则`);
console.log(`  ✅ 已加 HTML 守卫的正文外壳: ${guarded} 条`);
console.log(`  ❌ 无守卫且以 DOCTYPE/html 为边界的正文外壳: ${unguarded.length} 条（去重后）\n`);
for (const r of unguarded.slice(0, 12)) {
  console.log('■', r.file, '→', r.name, r.zeroLen ? ' [零长匹配风险]' : '');
  console.log('   regex:', r.re.slice(0, 110));
  console.log('   repl :', r.repl);
}
