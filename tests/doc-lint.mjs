#!/usr/bin/env node
/**
 * doc-lint.mjs — 锁住设计规范层的验收标准
 *
 * 依据：docs/superpowers/specs/2026-09-30-card-design-principles-design.md §8
 * 用法: node tests/doc-lint.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const REF = path.join(ROOT, 'references');
const SKILL = path.join(ROOT, 'SKILL.md');

let pass = 0, fail = 0;
const t = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

console.log('\n  设计规范层文档契约\n  ' + '─'.repeat(60));

const DP = path.join(REF, 'design-principles.md');
const PB = path.join(REF, 'platform-bindings.md');
const dp = read(DP);
const pb = read(PB);
const skill = read(SKILL);
const CAPS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];

console.log('\n  [1] 两份新文件存在');
t('design-principles.md 存在', dp.length > 0);
t('platform-bindings.md 存在', pb.length > 0);

console.log('\n  [2] design-principles.md 平台无关');
{
  const FORBIDDEN = ['RP-Hub', 'SillyTavern', '酒馆', 'variableState', 'uiTemplate',
    'rp_hub_ui_templates', 'markdownOnly', 'promptOnly', 'triggerSlash', 'useRegex',
    'scanDepth', 'matchWholeWords', 'data-arcadia-state'];
  const hits = FORBIDDEN.filter((w) => dp.includes(w));
  t('全文无平台专有字段名/平台名', hits.length === 0, `命中: ${hits.join(', ')}`);
}

console.log('\n  [3] 能力清单完整');
{
  const missing = CAPS.filter((c) => !new RegExp(`\\b${c}\\b`).test(dp));
  t('design-principles.md 声明 C1–C7', missing.length === 0, `缺: ${missing.join(', ')}`);
  const missing2 = CAPS.filter((c) => !new RegExp(`\\b${c}\\b`).test(pb));
  t('platform-bindings.md 绑定 C1–C7', missing2.length === 0, `缺: ${missing2.join(', ')}`);
}

console.log('\n  [4] 绑定矩阵两平台齐全');
t('含 RP-Hub 栏', pb.includes('RP-Hub'));
t('含 SillyTavern 栏', pb.includes('SillyTavern'));
t('标注插件依赖', /插件/.test(pb));
t('标注降级表现', /降级/.test(pb));

console.log('\n  [5] 反模式五条');
{
  // 只在反模式小节内计数：§3 也有编号列表，全局计数会误算成 10 条
  const sec = dp.split('## 五、反模式清单')[1] || '';
  const body = sec.split(/\n## /)[0];
  const n = (body.match(/^\s*\d+\.\s\*\*/gm) || []).length;
  t('design-principles.md 反模式为 5 条', n === 5, `实际 ${n} 条`);
}

console.log('\n  [6] SKILL.md 已升级');
// 断言「升级已落地」而不是把版本号钉死：钉死会让每次合法升版都误报红。
// 这里要求 >= 0.3.0（跨平台层引入的那一版）。
{
  const cur = (skill.match(/^version:\s*"([^"]+)"/m) || [, ''])[1];
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  };
  t('version >= 0.3.0', !!cur && cmp(cur, '0.3.0') >= 0, `实际 ${cur || '(读不到)'}`);
}
t('硬边界已改为能力分开声明', skill.includes('设计原则') && skill.includes('平台无关'));
t('引用了两份新文件', skill.includes('design-principles.md') && skill.includes('platform-bindings.md'));
t('不再宣称"不碰酒馆"', !/不做酒馆[（(]SillyTavern[）)]兼容/.test(skill));

console.log('\n  ' + '─'.repeat(60));
console.log(`  通过 ${pass} / 失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
