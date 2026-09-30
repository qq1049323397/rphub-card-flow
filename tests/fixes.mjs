#!/usr/bin/env node
/**
 * fixes.mjs — 三个脚本缺陷的回归测试
 *
 * 来源：2026-09-30 一次真实卡审计中实际绊倒过我的三个坑。
 * 每个缺陷都有实测证据，测试先红后绿。
 *
 * 用法: node tests/fixes.mjs
 */
import { auditWrapper } from '../scripts/regex-doctor.mjs';
import { normalizeReplacement, tokenDeclaredIn } from '../scripts/scan-utils.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..', 'scripts');
// 范本卡**默认不找**。这个包是发给别人的，绝不能去摸一张本机上不存在的卡。
// 想拿真实卡做额外验证时才显式给路径（不给就整节跳过，其余断言照跑）：
//   RPHUB_CARD=/path/to/card.png node tests/fixes.mjs
const CARD = process.env.RPHUB_CARD || '';

let pass = 0, fail = 0;
const t = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('\n  三缺陷回归测试\n  ' + '─'.repeat(60));

// ── 缺陷 1：警告级发现不再打 ❌，也不该让 exit=1 ──────────────────────
console.log('\n  [1] regex-doctor 警告级不判缺陷');
{
  // 一条只产生 warnings（未包裹）、零 fails 的外壳正则：
  // 守卫用全串匹配，正文+HTML 时整条跳过 → noWrap，但绝无空容器。
  const regex = '^(?![\\s\\S]*(?:<!DOCTYPE|<html))([\\s\\S]+)$';
  const repl = '<div class="c">$1</div>';
  const a = auditWrapper(regex, repl);
  t('该用例确实只产生 warnings', a.fails.length === 0 && a.warnings.length > 0,
    `fails=${a.fails.length} warnings=${a.warnings.length}`);
  t('auditWrapper 自带 hasFatal 判据', typeof a.hasFatal === 'boolean' && a.hasFatal === false,
    `hasFatal=${a.hasFatal}`);
}
{
  // 真的有空容器时必须仍然判缺陷
  const regex = '^(?![\\s\\S]*<!DOCTYPE)([\\s\\S]*?)$';
  const repl = '<div class="c">$1</div>';
  const a = auditWrapper(regex, repl);
  t('真空容器仍判缺陷', a.hasFatal === true && a.fails.length > 0,
    `hasFatal=${a.hasFatal} fails=${a.fails.length}`);
}

// ── 缺陷 2：D 档必须区分 useRegex 真假 ─────────────────────────────────
console.log('\n  [2] key-audit D 档区分 useRegex');
if (!fs.existsSync(CARD)) {
  console.log(`  ⚠️  跳过（范本卡不在: ${CARD}）`);
} else {
  let out = '';
  try { out = execFileSync(process.execPath, [path.join(SCRIPTS, 'key-audit.mjs'), CARD, '--json'], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; }
  let j = null; try { j = JSON.parse(out); } catch { /* ignore */ }
  t('--json 可解析', !!j);
  if (j) {
    t('D 档总数仍为 100（分档逻辑未被破坏）', j.tiers.D === 100, `实际 ${j.tiers.D}`);
    t('输出死键拆分字段', j.deadSplit && typeof j.deadSplit.literal === 'number',
      JSON.stringify(j.deadSplit));
    if (j.deadSplit) {
      t('字面死键为 6 条', j.deadSplit.literal === 6, `实际 ${j.deadSplit.literal}`);
      t('正则待定点为 94 条', j.deadSplit.regex === 94, `实际 ${j.deadSplit.regex}`);
    }
    t('dead 列表已标注 useRegex', Array.isArray(j.dead) && j.dead.every((d) => 'useRegex' in d));
  }
  // 文本模式必须把两类分开说，不能混成一句"死键"
  let txt = '';
  try { txt = execFileSync(process.execPath, [path.join(SCRIPTS, 'key-audit.mjs'), CARD], { encoding: 'utf8' }); }
  catch (e) { txt = e.stdout || ''; }
  t('文本模式区分「字面死键」与「正则待定点」',
    /字面死键/.test(txt) && /正则/.test(txt));
}

// ── 缺陷 3：$$ 转义规则 ───────────────────────────────────────────────
console.log('\n  [3] $$ 转义规则');
{
  // $$ → 字面 $，不是反向引用
  t('$$1 归一后不再是反向引用', normalizeReplacement('$$1').includes('\u0000') ||
    !/\$1/.test(normalizeReplacement('$$1')));
  // 真正的反向引用要保留
  t('$1 仍被识别为反向引用', /\$1/.test(normalizeReplacement('a $1 b')));
  // 混合：$$ 与 $1 并存
  const mix = normalizeReplacement('$$1 then $1');
  t('$$1 与 $1 混合时只保留后者为引用', !/\$1/.test(mix.slice(0, 6)));
  // $& / $0 / {{match}}
  t('$& 被识别', /\$&/.test(normalizeReplacement('x $& y')));
  t('$$& 不算引用', !/\$&/.test(normalizeReplacement('$$&')));
  // 实卡：那个 $$1 位于 JS 源码里，归一后不应再被当作反向引用
  if (fs.existsSync(CARD)) {
    const { loadCard } = await import('../scripts/rphub-card.mjs');
    const { card } = loadCard(CARD);
    const scripts = (card.data?.extensions?.regex_scripts) || [];
    const s = scripts.find((x) => (x.name || x.scriptName) === 'ARCADIA开场启动界面');
    if (s) {
      const r = String(s.replacement ?? s.replaceString ?? '');
      t('实卡 replacement 含 $$1', r.includes('$$1'));
      t('归一后该脚本不再被误判为「保留捕获」',
        !/\$1/.test(normalizeReplacement(r)));
    }
  }
}

// ── 缺陷 3b：令牌声明池（消费≠生产）──────────────────────────────────
console.log('\n  [3b] 令牌声明池区分「声明」与「使用」');
{
  // 声明池 = 正则 replacement + ui 模板；使用池 = 世界书条目 content
  t('replacement 中的 [TOK|x] 算声明', tokenDeclaredIn('ARRIVAL_IDENTITY', '[ARRIVAL_IDENTITY|ordinary]'));
  t('正文里的裸词不算声明', !tokenDeclaredIn('ARRIVAL_IDENTITY', '由ARRIVAL_IDENTITY决定穿越身份'));
  t('带竖线的具体变体算声明', tokenDeclaredIn('RELATION_PRESET', '[RELATION_PRESET|saint]'));
}

console.log('\n  ' + '─'.repeat(60));
console.log(`  通过 ${pass} / 失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
