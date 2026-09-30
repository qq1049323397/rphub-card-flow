#!/usr/bin/env node
/**
 * skeleton.mjs — 读出「这张卡自己的骨架」
 *
 * 原则：不预设任何题材模板，不规定段数。
 *   段数、段边界、每段装什么类别、命名法、字数地板 —— 全部从卡里量出来。
 *
 * 用法：
 *   node skeleton.mjs <card.png|card.json> [--json] [--min-gap=150] [--batch=200]
 */
import { loadCard, entries, commentPrefix, cjkCount, quantile, deadFields } from './rphub-card.mjs';

// ── 参数 ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
if (!path) {
  console.error('用法: node skeleton.mjs <card.png|card.json> [--json] [--min-gap=150] [--batch=200]');
  process.exit(2);
}
const asJson = args.includes('--json');
const getNum = (name, fb) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : fb;
};

// ── 段边界探测 ─────────────────────────────────────────────────────────
// order 是作者手排的层号。自然断层 = 相邻 order 差值超过阈值。
// 段数不定死：给出候选断点表，并按 maxSegs 合并最小断层，说明合并了什么。
function detectGaps(orders, minGap, maxSegs) {
  const uniq = [...new Set(orders)].sort((a, b) => a - b);
  if (uniq.length <= 1) return { segments: [uniq], cuts: [], threshold: 0, merged: [] };

  // 所有相邻差
  const diffs = [];
  for (let i = 1; i < uniq.length; i++) diffs.push({ i, gap: uniq[i] - uniq[i - 1] });
  const sorted = [...diffs].sort((a, b) => a.gap - b.gap);
  const med = quantile(sorted.map((d) => d.gap), 0.5);
  const p90 = quantile(sorted.map((d) => d.gap), 0.9);

  // 自适应阈值：至少 10，取"中位×8"与 P90 的较大者
  let threshold = minGap == null ? Math.max(10, Math.round(Math.max(med * 8, p90))) : minGap;

  // 候选断层（gap >= threshold）
  let cuts = diffs.filter((d) => d.gap >= threshold);

  // 若段数超上限，从最小的断层开始合并（抬高阈值），并记录被合并掉的分界
  const merged = [];
  while (maxSegs != null && cuts.length + 1 > maxSegs && cuts.length > 0) {
    cuts.sort((a, b) => a.gap - b.gap);
    const dropped = cuts.shift();
    merged.push({ between: [uniq[dropped.i - 1], uniq[dropped.i]], gap: dropped.gap });
    threshold = cuts.length ? Math.min(...cuts.map((c) => c.gap)) : threshold;
  }

  const cutSet = new Set(cuts.map((c) => c.i));
  const segments = [];
  let cur = [uniq[0]];
  for (let i = 1; i < uniq.length; i++) {
    if (cutSet.has(i)) {
      segments.push(cur);
      cur = [uniq[i]];
    } else {
      cur.push(uniq[i]);
    }
  }
  segments.push(cur);

  return {
    segments,
    threshold,
    merged,
    candidates: diffs.filter((d) => d.gap > 1).sort((a, b) => b.gap - a.gap).slice(0, 12)
      .map((d) => ({ between: [uniq[d.i - 1], uniq[d.i]], gap: d.gap })),
  };
}


// ── 类别骨架 ───────────────────────────────────────────────────────────
// 对每个类别，从该卡自己的条目里提取"小节骨架"：条目标题 + 常见小节名。
function sectionSkeleton(group) {
  const headingBag = new Map();
  const bracketBag = new Map();
  for (const e of group) {
    const c = e.content || '';
    for (const m of c.matchAll(/^[ \t]*#{2,4}[ \t]*(.+?)[ \t]*$/gm)) {
      const t = m[1].trim();
      if (t) headingBag.set(t, (headingBag.get(t) || 0) + 1);
    }
    for (const m of c.matchAll(/^[ \t]*【(.+?)】[ \t]*$/gm)) {
      const t = m[1].trim();
      if (t) bracketBag.set(t, (bracketBag.get(t) || 0) + 1);
    }
  }
  const top = (bag, n) => [...bag.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { headings: top(headingBag, 12), brackets: top(bracketBag, 12) };
}

/** 该类别的字段模板：作者在这类条目上实际用了哪些运行时字段 */
function fieldTemplate(group) {
  const bag = new Map();
  for (const e of group) {
    const rf = [...e._rawFields, ...e._extFields.map((f) => 'ext::' + f)];
    for (const f of rf) bag.set(f, (bag.get(f) || 0) + 1);
  }
  return [...bag.entries()].sort((a, b) => b[1] - a[1]);
}

/** 把一段里的条目按类别拆成子批（段太粗时用） */
function batches(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── 主流程 ─────────────────────────────────────────────────────────────
const { card, source, meta } = loadCard(path);
const list = entries(card);

if (!list.length) {
  console.error('这张卡没有世界书条目（character_book.entries 为空）');
  process.exit(1);
}

const minGap = getNum('min-gap', null);
const batchSize = getNum('batch', 200);
const maxSegs = getNum('max-segs', null);
const orders = list.map((e) => e.order);
const { segments, cuts, threshold, merged, candidates } = detectGaps(orders, minGap, maxSegs);

// 建 order → 条目 索引
const byOrder = new Map();
for (const e of list) {
  if (!byOrder.has(e.order)) byOrder.set(e.order, []);
  byOrder.get(e.order).push(e);
}

// 全卡类别画像（用于给每段标注）
const allByCat = new Map();
for (const e of list) {
  const c = commentPrefix(e.comment);
  if (!allByCat.has(c)) allByCat.set(c, []);
  allByCat.get(c).push(e);
}

const catStats = (group) => {
  const lens = group.map((e) => cjkCount(e.content)).sort((a, b) => a - b);
  return {
    n: group.length,
    cjk: { min: lens[0] ?? 0, p25: quantile(lens, 0.25), p50: quantile(lens, 0.5), p75: quantile(lens, 0.75), max: lens.at(-1) ?? 0, avg: lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0 },
    constant: group.filter((e) => e.constant).length,
    regexKeys: group.filter((e) => e.useRegex).length,
    noKeys: group.filter((e) => !e.constant && e.keys.length === 0).length,
    positions: [...new Set(group.map((e) => e.position))],
  };
};

// 组装每段
const segOut = segments.map((orderValues, idx) => {
  const items = orderValues.flatMap((o) => byOrder.get(o) || []);
  const catBag = new Map();
  for (const e of items) {
    const c = commentPrefix(e.comment);
    if (!catBag.has(c)) catBag.set(c, []);
    catBag.get(c).push(e);
  }
  const cats = [...catBag.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, group]) => ({
      name,
      ...catStats(group),
      skeleton: sectionSkeleton(group),
      fields: fieldTemplate(group).slice(0, 14),
      prefixSamples: group.slice(0, 3).map((e) => e.comment),
      batches: group.length > batchSize ? Math.ceil(group.length / batchSize) : 1,
    }));

  return {
    index: idx + 1,
    orderRange: [orderValues[0], orderValues.at(-1)],
    orderSteps: orderValues.length,
    count: items.length,
    constant: items.filter((e) => e.constant).length,
    cats,
  };
});

// ── 骨架指纹：用于判断"还是不是同一张卡的同一个骨架" ──────────────────
function fingerprint(s) {
  return s.map((x) => `${x.orderRange[0]}-${x.orderRange[1]}:${x.count}:${x.cats.map((c) => c.name).join('/')}`).join('|');
}

// ── 输出 ───────────────────────────────────────────────────────────────
if (asJson) {
  const payload = {
    card: {
      name: (() => { const d = card.data || card; return d.name || '(无名)'; })(),
      source, path: meta.path, bytes: meta.bytes,
      entries: list.length,
      constant: list.filter((e) => e.constant).length,
      orderRange: [Math.min(...orders), Math.max(...orders)],
    },
    gapThreshold: threshold,
    mergedCuts: merged,
    candidateCuts: candidates,
    segments: segOut,
    deadFields: deadFields(list),
    fingerprint: fingerprint(segOut),
  };
  console.log(JSON.stringify(payload, null, 1));
  process.exit(0);
}

// ── 人类可读输出 ───────────────────────────────────────────────────────
const d = card.data || card;
const W = 84;
const line = (ch = '─') => console.log(ch.repeat(W));

console.log('');
line('═');
console.log(`  骨架报告 · ${d.name || '(无名)'}`);
console.log(`  来源 ${source}   条目 ${list.length}   常驻 ${list.filter((e) => e.constant).length}`);
console.log(`  order 区间 ${Math.min(...orders)} ~ ${Math.max(...orders)}   段数 ${segOut.length}   断层阈值 ${threshold}`);
if (merged.length) {
  console.log(`  （为收敛到 ${maxSegs} 段，合并了 ${merged.length} 个最小断层：` +
    merged.slice(0, 6).map((m) => `${m.between[0]}→${m.between[1]}(gap${m.gap})`).join('  ') + '）');
}
line('═');

for (const s of segOut) {
  const constMark = s.constant ? `  常驻 ${s.constant}` : '';
  console.log('');
  console.log(`  ┌─ 第 ${s.index} 段   order ${s.orderRange[0]} ~ ${s.orderRange[1]}   ${s.count} 条${constMark}`);
  for (const c of s.cats) {
    console.log(`  │   ${c.name.padEnd(12)} ${String(c.n).padStart(5)} 条   中位 ${String(c.cjk.p50).padStart(4)} 字   ` +
      `P25 ${c.cjk.p25} / P75 ${c.cjk.p75} / 最长 ${c.cjk.max}   常驻 ${c.constant}   ` +
      `位置 ${c.positions.join(',')}`);
    const hd = c.skeleton.headings.slice(0, 6).map(([t, n]) => `${t}×${n}`);
    if (hd.length) console.log(`  │       小节骨架: ${hd.join('  ')}`);
    const br = c.skeleton.brackets.slice(0, 6).map(([t, n]) => `【${t}】×${n}`);
    if (br.length) console.log(`  │       方括号节: ${br.join('  ')}`);
    if (c.batches > 1) console.log(`  │       ↳ 该类别 ${c.n} 条，建议分 ${c.batches} 批（每批约 ${batchSize}）`);
  }
  console.log(`  └─`);
}

const dead = deadFields(list);
if (dead.length) {
  console.log('');
  line();
  console.log('  ⚠ 写了但运行时读不到的字段（白写）：');
  for (const [f, n] of dead.slice(0, 12)) console.log(`      ${f.padEnd(24)} ${n} 条`);
  const more = dead.length - 12;
  if (more > 0) console.log(`      ... 另有 ${more} 种`);
}

console.log('');
line('═');
console.log(`  骨架指纹: ${fingerprint(segOut).slice(0, 110)}${fingerprint(segOut).length > 110 ? '…' : ''}`);
console.log('');
