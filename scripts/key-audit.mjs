#!/usr/bin/env node
/**
 * key-audit.mjs — 世界书关键词「真实可触达性」审查
 *
 * 为什么需要它（2026-09-23 审计结论）：
 *   用户上传的《世界书关键词审查修理》skill 把「卡面（description/personality/scenario…）」
 *   列为 A 级可靠触发源，我原先的 gate.mjs 也这么算。**两边都错了。**
 *   源码事实（data-services.js L581-616）：
 *     非 constant 条目能否触发，只看 keys 是否出现在
 *       chatMessages.slice(-scanDepth) 的 content 里。
 *     chatMessages 来自 getPostprocessedChatMessages(chatHistory, {includeSystem:false})，
 *     即【只有 user/assistant 聊天消息】。
 *   → description / personality / scenario / system_prompt / post_history_instructions
 *     是 prompt 层，永远不进扫描窗。它们的键不会因为写在卡面就直接触发。
 *   → 唯一例外：first_mes 作为 chatHistory[0]（role=assistant）真的在扫描窗里。
 *
 * 所以键按「离扫描窗多远」分四档：
 *   A 直接  键出现在开场白(或已发生的对话里)           → 立即触发
 *   B 间接  键只出现在 prompt 层/常驻正文              → 靠 AI 被诱导写出该词，下一轮才可能进窗
 *   C 链式  键只出现在其他条目正文                     → 上游先触发，且 AI 复述，才可能
 *   D 死    全卡零出现                                 → 永不触发
 *
 * 用法：
 *   node key-audit.mjs <card.png> [--json] [--segment=N] [--tier=A|B|C|D]
 *   node key-audit.mjs <card.png> --list-dead
 */
import { loadCard, unwrap, entries, keyMatches } from './rphub-card.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const listTier = (() => { const a = args.find((x) => x.startsWith('--tier=')); return a ? a.split('=')[1].toUpperCase() : null; })();
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('用法: node key-audit.mjs <card.png> [--json] [--tier=A|B|C|D]'); process.exit(2); }

const { card, source } = loadCard(file);
const { data } = unwrap(card);
const all = entries(card);

// ── 文本池 ─────────────────────────────────────────────────────────────
// A 池：真的在扫描窗里。开场白 = chatHistory[0]（role=assistant）。
//      备用开场白只在玩家选用时才进历史，单独标注。
const inWindow = [data.first_mes].filter(Boolean).join('\n');
const altGreetings = Array.isArray(data.alternate_greetings) ? data.alternate_greetings.filter(Boolean).join('\n') : '';
// B 池：prompt 层 + 常驻条目正文（AI 每轮都读得到，但不在扫描窗）
const promptLayer = ['description', 'personality', 'scenario', 'system_prompt', 'post_history_instructions', 'mes_example']
  .map((k) => String(data[k] ?? '')).filter(Boolean).join('\n');
const constEntries = all.filter((e) => e.constant);
const constText = constEntries.map((e) => e.content + '\n' + e.comment).join('\n');
// C 池：其他条目正文
const otherEntries = all.map((e) => e.content + '\n' + e.comment).join('\n');

// ── 分段 ───────────────────────────────────────────────────────────────
const segArg = (() => { const a = args.find((x) => x.startsWith('--segment=')); return a ? Number(a.split('=')[1]) : null; })();
const orders = [...new Set(all.map((e) => e.order))].sort((a, b) => a - b);
let scope = all;
let segLabel = `全卡 ${all.length}`;
if (segArg != null) {
  const sorted = [...orders].sort((a, b) => a - b);
  const cut = sorted[segArg - 1];
  const next = sorted[segArg];
  scope = all.filter((e) => (next === undefined ? e.order >= cut : e.order >= cut && e.order < next));
  segLabel = `第 ${segArg} 段（order ${cut}${next === undefined ? '+' : `~${next}`}）${scope.length} 条`;
}

// ── 逐条目定档 ─────────────────────────────────────────────────────────
// 分档与 gate.mjs 完全一致，避免两个工具对同一概念给出不同数字。
//   A 直接：键在扫描窗（开场白/对话）
//   B 间接：键只在 prompt 层（AI 读得到但不在扫描窗）
//   S 常驻索引：键被常驻条目点名（每轮出现在 prompt，AI 说得出）
//   C 链式：键只在其他条目正文
//   D 死：全卡零出现
function tierOf(e) {
  for (const k of e.keys) if (keyMatches(e, k, inWindow)) return 'A';
  for (const k of e.keys) if (keyMatches(e, k, promptLayer)) return 'B';
  for (const k of e.keys) if (keyMatches(e, k, constText)) return 'S';
  for (const k of e.keys) if (keyMatches(e, k, otherEntries)) return 'C';
  return 'D';
}

const scored = scope
  .filter((e) => !e.constant && e.keys.length > 0)
  .map((e) => ({ e, tier: tierOf(e) }));

const buckets = { A: [], B: [], S: [], C: [], D: [] };
for (const s of scored) buckets[s.tier].push(s.e);
const tot = scored.length || 1;
const pct = (n) => `${(n / tot * 100).toFixed(1)}%`;
const constantNoKey = scope.filter((e) => e.constant).length;

// 正则键单独统计（不按字面判死）
const regexEntries = scope.filter((e) => !e.constant && e.keys.length && e.useRegex);

// ── D 档拆分 ───────────────────────────────────────────────────────────
// D 档混了两种性质完全不同的条目，必须分开说，否则会得出「100 个死键」的错误结论：
//   · 字面死键   —— useRegex=false，键是普通字符串，全卡零出现 → 真的永不触发
//   · 正则待定点 —— useRegex=true，键是正则，静态文本里匹配不到是**正常的**，
//                   它们等的是运行时才生成的正文（如 [SCENE|…|Zone 0/…]）。
//                   实卡实测：D 档 100 条里 94 条是正则键，6 条是字面键。
//                   把这 94 条报成死键是工具造成的假阳性。
const isLiteralDead = (e) => !e.useRegex;
const deadAll = buckets.D;
const deadLiteral = deadAll.filter(isLiteralDead);
const deadRegex = deadAll.filter((e) => e.useRegex);
const deadSplit = { literal: deadLiteral.length, regex: deadRegex.length };

if (asJson) {
  console.log(JSON.stringify({
    card: data.name || '(无名)', source, entries: all.length, scope: segLabel,
    scored: tot, constant: constantNoKey, regexEntries: regexEntries.length,
    tiers: { A: buckets.A.length, B: buckets.B.length, S: buckets.S.length, C: buckets.C.length, D: buckets.D.length },
    deadSplit,
    dead: buckets.D.map((e) => ({ comment: e.comment, keys: e.keys, useRegex: !!e.useRegex })),
  }, null, 1));
  process.exit(deadLiteral.length ? 1 : 0);
}

const line = '  ' + '─'.repeat(64);
console.log(`\n  世界书关键词可达性审查 · ${data.name || '(无名)'}`);
console.log(`  来源 ${source}   条目 ${all.length}   受检范围 ${segLabel}`);
console.log(line);
console.log(`  有键的非纯常驻条目: ${tot}    常驻条目: ${constantNoKey}    正则键条目: ${regexEntries.length}`);
console.log(line);
const rows = [
  ['A', '直接', '键在开场白/对话里 —— 立即触发', buckets.A.length],
  ['B', '间接', '键只在 prompt 层 —— 靠 AI 写出，延迟一轮', buckets.B.length],
  ['S', '常驻索引', '键被常驻条目点名 —— AI 每轮读得到，说得出才触发', buckets.S.length],
  ['C', '链式', '键只在别的条目正文 —— 上游先触发才可能', buckets.C.length],
  ['D', '待定点', '静态文本零命中 —— 需拆看是字面死键还是正则待定点', buckets.D.length],
];
for (const [t, name, desc, n] of rows) {
  const mark = t === 'D' && deadLiteral.length ? '❌' : t === 'A' ? '✅' : t === 'S' ? '✦' : '·';
  console.log(`  ${mark} ${t} ${name.padEnd(4)} ${String(n).padStart(4)}  ${pct(n).padStart(6)}   ${desc}`);
}
console.log(line);
// D 档必须拆开报，否则「100 个死键」是假的
if (buckets.D.length) {
  console.log(`  D 档拆分（这是关键，别把两类混着看）：`);
  console.log(`     ❌ 字面死键   ${String(deadLiteral.length).padStart(4)} 条  普通字符串键，全卡零出现 → 真的永不触发`);
  console.log(`     ℹ️  正则待定点 ${String(deadRegex.length).padStart(4)} 条  正则键，等的是运行时正文 → 静态扫不到属正常`);
  console.log(line);
}
const noImmediate = buckets.B.length + buckets.S.length + buckets.C.length + buckets.D.length;
console.log(`  能立即触发的: ${buckets.A.length}/${tot} = ${pct(buckets.A.length)}`);
console.log(`  无立即入口的: ${noImmediate}/${tot} = ${pct(noImmediate)}  ← 靠 AI 配合、常驻点名或上游带动`);
console.log(`  其中已被常驻索引点名兜住的: ${buckets.S.length}/${noImmediate} = ${(() => { return noImmediate ? (buckets.S.length / noImmediate * 100).toFixed(1) + '%' : '—'; })()}`);

if (listTier && buckets[listTier]) {
  console.log(line);
  const list = listTier === 'D' ? deadLiteral : buckets[listTier];
  const label = listTier === 'D' ? 'D 档·字面死键（已排除正则待定点）' : `${listTier} 档`;
  console.log(`  ${label}清单（${list.length} 条）:`);
  for (const e of list.slice(0, 40)) {
    console.log(`   · ${e.comment || '(无注释)'}`);
    console.log(`     键: ${e.keys.join(' / ')}`);
  }
  if (list.length > 40) console.log(`   …还有 ${list.length - 40} 条`);
}
console.log();
process.exit(deadLiteral.length ? 1 : 0);
