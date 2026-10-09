#!/usr/bin/env node
/**
 * gate.mjs — 闸门：按「这张卡自己」的分布判合格
 *
 * 设计修正（v2，2026-09-19）：
 *   · 正则 key 与字面 key 分开判。正则 key（如 [ORIGIN_ROUTE|A|...]）是状态块，
 *     本来就不会以字面出现在正文里，用字面匹配判它"死键"是错的。
 *     对正则 key 用「能否匹配到卡面/常驻文本」来判可达性。
 *   · 字数地板不再用 P25（按定义必然命中 25%，等于废话），
 *     改为「低于同类中位数的 THIN_RATIO」才算过薄。
 *   · 常驻不再看比例。卡有 600 条还是 3800 条，常驻都只需要十几条；
 *     改判「有没有一条真正起索引作用的常驻条目，覆盖了多少 key」。
 *
 * 阈值来源：该卡自身的同类分布。只有死键和无递归补偿是跨卡通用的硬事实。
 *
 * 用法：
 *   node gate.mjs <card> [--json] [--thin=0.5] [--segment=N] [--show=25]
 */
import {
  loadCard, entries, unwrap, commentPrefix, cjkCount, quantile, deadFields,
  checkBareNameGuard,
} from './rphub-card.mjs';
import { regexScripts } from './regex-doctor.mjs';
import { keepsCapture as keepsCaptureRef } from './scan-utils.mjs';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
if (!path) {
  console.error('用法: node gate.mjs <card.png|card.json> [--json] [--thin=0.5] [--segment=N] [--show=25]');
  process.exit(2);
}
const asJson = args.includes('--json');
const getNum = (n, fb) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? Number(a.split('=')[1]) : fb;
};

const THIN = getNum('thin', 0.5);   // 低于同类中位数的这个比例 = 过薄
const SEGMENT = getNum('segment', null);
const SHOW = getNum('show', 25);

const { card, source } = loadCard(path);
const { data } = unwrap(card);
const all = entries(card);
if (!all.length) { console.error('这张卡没有世界书条目'); process.exit(1); }

// 触发窗口事实（RP-Hub 无递归）：
//   resolveWorldInfoEntries() 只扫最近 scanDepth 层的 user+assistant 消息，
//   includeSystem=false —— 已注入的世界书正文不回流，所以不存在变相递归。
//   scanDepth 为 null 时用全局设置（app.js 默认 2；maxDepth=0 表示不封顶）。
const scanDepths = all.map((e) => e.scanDepth).filter((v) => v !== null);
const scanMax = scanDepths.length ? Math.max(...scanDepths) : 2;
const scanMin = scanDepths.length ? Math.min(...scanDepths) : 2;

// ── 分段（与 skeleton 同算法，段号一致）──────────────────────────────
function detectSegments(list, minGap) {
  const uniq = [...new Set(list.map((e) => e.order))].sort((a, b) => a - b);
  if (uniq.length <= 1) return [uniq];
  const diffs = [];
  for (let i = 1; i < uniq.length; i++) diffs.push(uniq[i] - uniq[i - 1]);
  const s = [...diffs].sort((a, b) => a - b);
  const threshold = minGap == null ? Math.max(10, Math.round(Math.max(quantile(s, 0.5) * 8, quantile(s, 0.9)))) : minGap;
  const segs = []; let cur = [uniq[0]];
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i] - uniq[i - 1] >= threshold) { segs.push(cur); cur = [uniq[i]]; } else cur.push(uniq[i]);
  }
  segs.push(cur);
  return segs;
}
const segments = detectSegments(all, null);
const scope = SEGMENT == null ? all : all.filter((e) => {
  const s = segments[SEGMENT - 1];
  return s && e.order >= s[0] && e.order <= s.at(-1);
});
if (SEGMENT != null && !scope.length) {
  console.error(`没有第 ${SEGMENT} 段（共 ${segments.length} 段）`);
  process.exit(2);
}

// ── 文本池 ─────────────────────────────────────────────────────────────
// ⚠ 2026-09-23 修正（重要）：以前这里把 description/personality/scenario 当成触发源，
//   这是错的。源码 data-services.js L581-616：非 constant 条目只看 keys 是否出现在
//   chatMessages.slice(-scanDepth) —— 而 chatMessages = getPostprocessedChatMessages(
//   chatHistory, {includeSystem:false})，只有 user/assistant 聊天消息。
//   卡面字段（description/personality/scenario/system_prompt/post_history）是 prompt 层，
//   【永远不进扫描窗】。唯一例外：first_mes 会成为 chatHistory[0]（role=assistant）。
//   详见 references/key-reachability.md。
const inWindowText = [data.first_mes].filter(Boolean).join('\n')
  + '\n' + (Array.isArray(data.alternate_greetings) ? data.alternate_greetings.filter(Boolean).join('\n') : ''); // 备用开场白：玩家选中后才进历史
const promptLayerText = ['description', 'personality', 'scenario', 'system_prompt', 'post_history_instructions', 'mes_example']
  .map((k) => String(data[k] ?? '')).join('\n');
const surface = inWindowText + '\n' + promptLayerText; // 兼容旧变量名：仍是"卡面"，但下面按档区分
const constEntries = all.filter((e) => e.constant);
const constText = constEntries.map((e) => e.content + '\n' + e.comment).join('\n');
const otherText = all.map((e) => e.content + '\n' + e.comment).join('\n');

// ── 检查 1：字面 key 的死键（硬）+ 分档 ────────────────────────────────
const literal = scope.filter((e) => !e.constant && e.keys.length > 0 && !e.useRegex);
const regexed = scope.filter((e) => !e.constant && e.keys.length > 0 && e.useRegex);

const deadKeys = []; const indexSaved = []; const indirectKeys = []; const chainedKeys = [];
for (const e of literal) {
  // A：键真的在扫描窗里（开场白）→ 立即触发
  if (e.keys.some((k) => inWindowText.includes(k))) continue;
  // B：键在 prompt 层或常驻正文 → 靠 AI 被诱导写出该词，延迟一轮才进窗
  if (e.keys.some((k) => promptLayerText.includes(k))) { indirectKeys.push(e); continue; }
  if (e.keys.some((k) => constText.includes(k))) { indexSaved.push(e); continue; }
  // C：键只在其他条目正文 → 上游先触发才可能
  if (e.keys.some((k) => otherText.includes(k))) { chainedKeys.push(e); continue; }
  // D：全卡零出现
  deadKeys.push(e);
}

// ── 检查 2：正则 key 可达性（软）──────────────────────────────────────
// 正则 key 不要求字面出现，只要求「能匹配到扫描窗内或 prompt 层的文本」。
function regexReachable(e) {
  for (const k of e.keys) {
    let re;
    try {
      let src = String(k); let flags = 'i';
      if (src.startsWith('/') && src.lastIndexOf('/') > 0) {
        const last = src.lastIndexOf('/');
        const pf = src.slice(last + 1);
        if (/^[dgimsuvy]*$/.test(pf)) { src = src.slice(1, last); flags = pf; }
      }
      flags = flags.replace(/g/g, '');
      if (!flags.includes('i')) flags += 'i';
      re = new RegExp(src, flags);
    } catch { continue; }
    if (re.test(inWindowText) || re.test(promptLayerText) || re.test(constText)) return true;
  }
  return false;
}
const unreachableRegex = regexed.filter((e) => !regexReachable(e));

// ── 检查 3：白写字段 ───────────────────────────────────────────────────
const dead = deadFields(all);

// ── 检查 4：过薄条目（相对同类中位数）─────────────────────────────────
const byCat = new Map();
for (const e of all) {
  const c = commentPrefix(e.comment);
  if (!byCat.has(c)) byCat.set(c, []);
  byCat.get(c).push(e);
}
const catMedian = new Map();
for (const [c, g] of byCat) {
  catMedian.set(c, quantile(g.map((e) => cjkCount(e.content)).sort((a, b) => a - b), 0.5));
}
const thin = scope
  .map((e) => {
    const c = commentPrefix(e.comment);
    const med = catMedian.get(c) ?? 0;
    const n = cjkCount(e.content);
    return { e, cat: c, n, med, ratio: med ? n / med : 1 };
  })
  .filter((x) => x.med >= 40 && x.ratio < THIN)
  .sort((a, b) => a.ratio - b.ratio);

// ── 检查 5：索引是否存在且真在干活 ────────────────────────────────────
// 一条常驻条目"像索引"的判据：它点名了至少 10 个别的条目的 key。
const indexEntries = constEntries.map((ce) => {
  const hit = new Set();
  for (const e of literal) {
    if (e === ce) continue;
    if (e.keys.some((k) => ce.content.includes(k) || ce.comment.includes(k))) hit.add(e);
  }
  return { entry: ce, covers: hit.size };
}).filter((x) => x.covers >= 10).sort((a, b) => b.covers - a.covers);

const literalCount = literal.length;
const coverage = literalCount ? indexSaved.length / literalCount : 0;
const deadRatio = literalCount ? deadKeys.length / literalCount : 0;

// ── 检查 6：结构卫生 ───────────────────────────────────────────────────
const emptyContent = scope.filter((e) => !String(e.content).trim());
const noKeysNotConst = scope.filter((e) => !e.constant && e.keys.length === 0);
const dupComment = (() => {
  const bag = new Map();
  for (const e of scope) bag.set(e.comment, (bag.get(e.comment) || 0) + 1);
  return [...bag.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
})();

// ── 检查 7：正则吞令牌（仅当被吞的令牌确实是某个条目的 key 时才算病）─────
// 来源：审计用户上传的 zip。成立的事实：replaceString 不含 $1/{{match}} 时，
// applyDisplayRegex 会把整段匹配替换掉；若被替换掉的文本正是某条目依赖的 key，
// 该 key 就从消息里消失，下一轮扫描窗扫不到 → 条目全灭。
// 关键限定：显示正则本来就该吃掉令牌把它渲染成面板，所以只有
// 「令牌名同时也是世界书 key」才是真缺陷。
const scripts = regexScripts(card);
const allKeys = new Set();
for (const e of all) for (const k of e.keys) allKeys.add(String(k));
const tokenSwallow = [];
for (const s of scripts) {
  const re = String(s.regex || s.findRegex || '');
  const repl = String(s.replacement ?? s.replaceString ?? '');
  if (!re) continue;
  const keepsCapture = keepsCaptureRef(repl);
  if (keepsCapture) continue;
  // 正则里出现的字面令牌名，如 [STAT_SET|...] 里的 STAT_SET。
  // 令牌名不限于 ASCII —— 实卡里有 [初始契约伙伴|...] 这类中文令牌。
  // 字符类必须排除反斜杠：正则在源码里写作 \[STAT_SET\|，若把 \ 吞进令牌名
  // 会得到 "STAT_SET\"，与世界书 key 对不上 → 漏报。
  const tokens = [...re.matchAll(/\[([^\[\]|\\\r\n]{2,}?)\s*(?=\\?\||\])/g)].map((m) => m[1].trim());
  const hit = tokens.filter((tk) => allKeys.has(tk) || allKeys.has(`[${tk}`));
  if (hit.length) {
    tokenSwallow.push({ name: s.name || s.scriptName || '(无名)', tokens: hit, regex: re.slice(0, 90) });
  }
}

// ── 判定 ───────────────────────────────────────────────────────────────
const n = scope.length;
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const findings = [];

findings.push({
  id: 'dead-keys',
  level: deadRatio > 0.5 ? 'fail' : deadRatio > 0.2 ? 'warn' : 'pass',
  label: `字面 key 死键率 ${pct(deadRatio)}`,
  detail: `${literalCount} 条字面 key 条目中，${deadKeys.length} 条的 key 全卡零出现。`
    + `RP-Hub 无递归：触发只扫最近 ${scanMin}~${scanMax} 层的 user+assistant 消息（含 AI 自己的叙述），`
    + `已注入的世界书不回流。==卡面 description/personality/scenario 是 prompt 层，不进扫描窗==，`
    + `所以写在卡面 ≠ 能触发；只有 first_mes 会成为 chatHistory[0]。`,
  fix: '把名字写进常驻索引条目（AI 每轮读得到、说得出），或把 key 换成玩家一定会说的泛称。',
});

findings.push({
  id: 'indirect-keys',
  level: indirectKeys.length / (literalCount || 1) > 0.9 ? 'warn' : 'pass',
  label: `B 档（仅 prompt 层，无立即入口）${indirectKeys.length} 条 = ${pct(indirectKeys.length / (literalCount || 1))}`,
  detail: '键只出现在 description/personality/scenario/system_prompt/post_history 这些 prompt 层字段里。'
    + '这些文本 AI 每轮都读得到，但【不在扫描窗】；必须等 AI 自己把这个词写进正文，下一轮才触发。'
    + '占比接近 100% 时，全卡触发都建立在「AI 会照做」之上——这是设计选择，不是错误，但要知道风险。',
  fix: '给关键剧情补输出契约（每轮必写的地点/时辰/阶段槽位），把键挂到 AI 每轮必写的槽位值上。',
});

findings.push({
  id: 'index-coverage',
  level: coverage >= 0.6 ? 'pass' : coverage >= 0.25 ? 'warn' : 'fail',
  label: `常驻索引覆盖 ${pct(coverage)}`,
  detail: `被常驻条目点名救活的字面 key 占比。范本实测：范本A 93.4% / 范本D 13.5% / 范本E 2.8%。`,
  fix: '写 constant=true 的索引条目，把人物全名、地点名、事件名成组列出，让 AI 看得见叫得出。',
});

findings.push({
  id: 'index-exists',
  level: indexEntries.length ? 'pass' : 'warn',
  label: indexEntries.length
    ? `索引条目 ${indexEntries.length} 条（最大覆盖 ${indexEntries[0].covers} 条）`
    : '没有起索引作用的常驻条目',
  detail: indexEntries.slice(0, 3).map((x) => `「${x.entry.comment.slice(0, 30)}」覆盖 ${x.covers} 条`).join('；')
    || `常驻共 ${constEntries.length} 条，但没有一条点名了 10 个以上条目 —— 常驻是规矩，索引才是解药。`,
  fix: '索引条目 = constant=true + 无 key + 正文里成组列出人名/地名/事件名。',
});

// ── 检查 6：裸名保底（v0.7.0，硬）──────────────────────────────────────
// 常驻索引证明 AI「读得到」这个名字，裸名保底证明 AI「写得出」这个名字。
// 两者不互相顶替：索引常照着键抄，两边逐字一致，于是所有工具都判通过，
// 而正文只写裸名时键仍匹配不到（键匹配是子串匹配）。
const constEnumValues = (() => {
  const out = new Set();
  for (const ce of constEntries) {
    for (const line of String(ce.content || '').split('\n')) {
      const v = line.trim();
      if (v && v.length <= 40) out.add(v);
    }
  }
  return [...out];
})();

const bareResults = scope
  .filter((e) => !e.constant && e.keys.length > 0)
  .map((e) => ({ e, r: checkBareNameGuard(e, { constEnumValues }) }));
const bareFail = bareResults.filter((x) => x.r.tier === 'fail');
const bareWarn = bareResults.filter((x) => x.r.tier === 'warn');
const bareUnknown = bareResults.filter((x) => x.r.tier === 'unknown');

findings.push({
  id: 'bare-name-guard',
  level: bareFail.length ? 'fail' : 'pass',
  label: `裸名保底 ${bareFail.length} 条未过 / 提醒 ${bareWarn.length} / 裸名未知 ${bareUnknown.length}`,
  detail: bareFail.slice(0, 5).map((x) => `「${x.e.comment}」裸名=${x.r.bare} 键=${x.e.keys.slice(0, 3).join('/')}`).join('  ')
    || `全部条目都有裸名键。${bareUnknown.length ? `另有 ${bareUnknown.length} 条取不到裸名，未参与判定。` : ''}`,
  fix: '补一个裸名键（键必须是裸名的子串，含相等）。前缀/动作形态可以留，但不能代替裸名。'
    + '长度不限：黑炎龙武装修罗铠甲 就用全名，不要砍成「铠甲」。',
});

findings.push({
  id: 'regex-keys',
  level: unreachableRegex.length === 0 ? 'pass' : unreachableRegex.length > regexed.length * 0.4 ? 'warn' : 'pass',
  label: `正则 key ${regexed.length} 条，其中 ${unreachableRegex.length} 条不可达`,
  detail: unreachableRegex.slice(0, 4).map((e) => `「${e.comment.slice(0, 26)}」`).join(' ')
    || '全部正则 key 都能匹配到卡面或常驻文本。',
  fix: '正则 key 靠状态块写入触发，需确认该状态块确实会被输出；否则改用字面 key。',
});

findings.push({
  id: 'dead-fields',
  level: dead.length ? 'warn' : 'pass',
  label: dead.length ? `${dead.length} 种字段白写` : '无白写字段',
  detail: dead.slice(0, 8).map(([f, c]) => `${f}(${c}条)`).join('  ') || '全部字段都会被运行时读取。',
  fix: '删掉或改写成运行时字段；extensions 里的同名键会被提升，但不在白名单里的依然无效。',
});

const thinRatio = n ? thin.length / n : 0;
findings.push({
  id: 'thin-entries',
  level: thinRatio > 0.3 ? 'fail' : thinRatio > 0.1 ? 'warn' : 'pass',
  label: `过薄条目 ${thin.length}/${n}（<同类中位 ${pct(THIN)}）`,
  detail: thin.slice(0, 5).map((x) => `${x.e.comment || '(无名)'} ${x.n}/${x.med}字`).join('  ') || `没有低于同类中位 ${pct(THIN)} 的条目。`,
  fix: '按同类已达标的条目补齐缺失小节（外观/感官/行为逻辑/关系/使用要求）。',
});

findings.push({
  id: 'structure',
  level: (emptyContent.length || noKeysNotConst.length) ? 'warn' : 'pass',
  label: `空内容 ${emptyContent.length} / 无key非常驻 ${noKeysNotConst.length}`,
  detail: `重复 comment ${dupComment.length} 组。`,
  fix: '空内容是死条目；无 key 又非常驻 = 永不触发；重复 comment 会让索引混淆。',
});

findings.push({
  id: 'token-swallow',
  level: tokenSwallow.length ? 'warn' : 'pass',
  label: `正则吞令牌 ${tokenSwallow.length} 条`,
  detail: '显示正则的 replaceString 不含 $1/{{match}} 时，匹配到的整段会被替换掉。'
    + '若那一段里含某个条目依赖的令牌 key，令牌就从消息里消失，下一轮扫描窗扫不到 → 该条目全灭。',
  fix: '在 replaceString 里回填 $1（或 {{match}}）保留令牌；只渲染、不吞掉触发词。',
});

// ── 检查 11：信息迷雾观察（v0.8.0，只报不判）──────────────────────────
// 一张卡里有没有「作者排好的剧情线」，脚本判不出来。
// 「阶段·C1_神物」（玩家驱动的状态档）和「主线·第1集」（作者排期）
// 在脚本眼里都是「带编号的条目」，长得一模一样。
// 所以这里只报观察，命中原句打出来，由作者判断是查漏还是抓加戏。

// (a) 字段名说「现在」，值里却是会漂的数
const FOG_FIELD_RE = /(当前状态|现状|现在是|此刻|目前|如今|当前)\s*[：:]\s*([^\n]{1,90})/g;
const DRIFT_RE = /(\d+(?:\.\d+)?\s*(?:度|%|％|百分点|级|阶|层|成))|(百分之[零一二三四五六七八九十百千点]+)|(\d{4}\s*[-年/]\s*\d{1,2})/;
const tenseDrift = [];
for (const e of scope) {
  for (const m of String(e.content || '').matchAll(FOG_FIELD_RE)) {
    if (DRIFT_RE.test(m[2])) {
      tenseDrift.push({ comment: e.comment, field: m[1], val: m[2].trim().slice(0, 46) });
    }
  }
}

// (b) 排期类标记 —— 只认强信号。
// 「最后」「最终」这类泛词会刷屏；「第N回」「第N节」在中文里也当量词用（第三回＝第三次），
// 同样会误报，都不收。只留真正的章节量词。
const NUM_SCHED_RE = /第\s*(?:\d{1,3}|[一二三四五六七八九十]{1,3})\s*(?:集|章|话|幕|篇|卷)/g;
const ENDGAME_RE = /(大结局|终局|结局|收束|终章|尾声)/g;
const DATE_RE = /\d{4}\s*年\s*\d{1,2}\s*月|\d{1,2}\s*月\s*\d{1,2}\s*日/g;
const collectMarks = (re, pred = () => true) => {
  const out = [];
  for (const e of scope) {
    if (!pred(e)) continue;
    const marks = [...new Set([...String(e.content || '').matchAll(re)].map((m) => m[0]))];
    if (marks.length) out.push({ comment: e.comment, marks: marks.slice(0, 5), n: marks.length });
  }
  return out;
};
const numberedSched = collectMarks(NUM_SCHED_RE);
// 结局词只有在常驻条目里才危险：常驻每轮都在，等于每轮提醒一遍「后面会怎样」
const endgameInConst = collectMarks(ENDGAME_RE, (e) => !!e.constant);
const dateMarks = collectMarks(DATE_RE);

// (c) 同一句具体事实在多个条目里逐字重复
const sentMap = new Map();
for (const e of scope) {
  const seen = new Set();
  for (const s of String(e.content || '').split(/[\n。！？]/)) {
    const t = s.trim();
    if (t.length < 20 || seen.has(t)) continue;
    seen.add(t);
    if (!sentMap.has(t)) sentMap.set(t, []);
    sentMap.get(t).push(e.comment);
  }
}
const dupFacts = [...sentMap.entries()].filter(([, cs]) => cs.length > 1).slice(0, 12);

findings.push({
  id: 'fog-observation',
  level: (tenseDrift.length || numberedSched.length || endgameInConst.length || dateMarks.length || dupFacts.length) ? 'warn' : 'pass',
  label: `迷雾观察：字段时态 ${tenseDrift.length} / 编号排期 ${numberedSched.length} / 常驻结局词 ${endgameInConst.length} / 具体日期 ${dateMarks.length} / 事实重复 ${dupFacts.length} 组`,
  detail: [
    tenseDrift.length
      ? `字段说「${tenseDrift[0].field}」值里是会漂的数：`
        + tenseDrift.slice(0, 3).map((x) => `「${(x.comment || '').slice(0, 18)}」${x.field}=${x.val}`).join('；')
      : '',
    numberedSched.length
      ? `编号排期：` + numberedSched.slice(0, 3).map((x) => `「${(x.comment || '').slice(0, 18)}」${x.marks.join('/')}`).join('；')
      : '',
    endgameInConst.length
      ? `常驻里的结局词（每轮都在，等于每轮提醒后面会怎样）：`
        + endgameInConst.slice(0, 3).map((x) => `「${(x.comment || '').slice(0, 18)}」${x.marks.join('/')}`).join('；')
      : '',
    dateMarks.length
      ? `具体日期：` + dateMarks.slice(0, 2).map((x) => `「${(x.comment || '').slice(0, 18)}」${x.marks.join('/')}`).join('；')
      : '',
    dupFacts.length
      ? `逐字重复（可能是刻意复用，也可能是漂移源）：`
        + dupFacts.slice(0, 2).map(([t, cs]) => `「${t.slice(0, 22)}…」在 ${cs.length} 条`).join('；')
      : '',
  ].filter(Boolean).join('  ') || '未观察到字段时态错位、编号排期、常驻结局词、具体日期或跨条目重复事实。',
  fix: '这一项只报观察，不判对错。作者要了主线 → 这是查漏；作者没要主线 → 这是抓 AI 自己加戏。'
    + '字段名说「当前/现状」时值必须是开局状态；同一件事实只留一个家。详见 references/information-fog.md。',
});

// ── 检查 12：插入位置观察（v0.8.0，只报不判）──────────────────────────
// 机制事实（源码 L4412-4475）：before_char 与 after_char 是同一条 role:'user' 消息；
// at_depth 会被 postprocessContextMessages 合并进相邻同角色消息（粘在玩家原话后面）。
// 默认值三处都是 at_depth（core-utils.js:702 / data-services.js:633 / app.js:8474）。
// 闸门给分布，不给结论 —— 实测各卡做法不一，没有共识。
const posCount = new Map();
let posMissing = 0;
for (const e of scope) {
  if (!e.position) { posMissing++; continue; }
  posCount.set(e.position, (posCount.get(e.position) || 0) + 1);
}
const posDist = [...posCount.entries()].sort((a, b) => b[1] - a[1]);
// 静态设定（人物/场所/道具/传闻…）放 at_depth：不随轮次变，没有收益只有代价
const STATIC_RE = /^(人物|场所|地点|道具|传闻|组织|势力|能力|机制|怪物|敌人|世界|档案|身体|关系|历史)[·・]/;
const staticAtDepth = scope.filter((e) => e.position === 'at_depth' && STATIC_RE.test(String(e.comment || '')));
// 酒馆的 @D depth=0 能选 role=system，所以那边把「输出格式/变量更新规则」放 at_depth 是对的。
// RP-Hub 的 at_depth 没有 role 字段，照搬会粘进玩家那条消息。这类条目在 RP-Hub 该去 system_top。
const RULE_RE = /(契约|规则|规范|法典|铁律|格式|输出结构|索引|枚举|变量|协议|约定|守则|指南|要求)/;
// 要求 constant：酒馆那边这类条目实测 100% 常驻；不加这一条，
// 「第十三幕 血统契约」这种剧情章节名会因为含「契约」被误抓。
const ruleAtDepth = scope.filter((e) =>
  e.position === 'at_depth' && e.constant
  && !STATIC_RE.test(String(e.comment || '')) && RULE_RE.test(String(e.comment || '')));
const noSystemTop = !posCount.has('system_top');

findings.push({
  id: 'position-observation',
  level: (staticAtDepth.length || ruleAtDepth.length || posMissing || noSystemTop) ? 'warn' : 'pass',
  label: `插入位置：${posDist.map(([p, c]) => `${p}×${c}`).join(' / ') || '(无)'}`,
  detail: [
    `before_char 与 after_char 是同一条 role:'user' 消息，只决定这条消息内部先后，机制上无区别。`,
    staticAtDepth.length
      ? `静态设定放 at_depth ${staticAtDepth.length} 条（放前导层与放这里模型读到的内容一样，但 at_depth 会被合并进玩家那条消息）：`
        + staticAtDepth.slice(0, 4).map((e) => `「${(e.comment || '').slice(0, 20)}」`).join(' ')
      : '',
    ruleAtDepth.length
      ? `规则/格式类条目放 at_depth ${ruleAtDepth.length} 条（酒馆那边 @D depth=0 能选 role=system，RP-Hub 没有这个字段）：`
        + ruleAtDepth.slice(0, 4).map((e) => `「${(e.comment || '').slice(0, 20)}」`).join(' ')
      : '',
    posMissing ? `有 ${posMissing} 条没写 position —— 源码默认值就是 at_depth，漏写等于选了它。` : '',
    noSystemTop ? '没有任何条目放 system_top —— 常驻规则失去了最高优先级。' : '',
  ].filter(Boolean).join('  '),
  fix: '规则/契约/格式/索引 → system_top；世界观与静态设定 → before_char 或 after_char（二选一）；'
    + '只有「走到那一步才成立」的当前阶段/状态块 → at_depth。每一条都显式写 position。'
    + '详见 references/insertion-position.md。',
});

const summary = {
  pass: findings.filter((f) => f.level === 'pass').length,
  warn: findings.filter((f) => f.level === 'warn').length,
  fail: findings.filter((f) => f.level === 'fail').length,
};
const ok = summary.fail === 0;

if (asJson) {
  console.log(JSON.stringify({
    card: { name: data.name || '(无名)', source, entries: all.length, segments: segments.length },
    scope: SEGMENT == null ? 'whole-card' : `segment-${SEGMENT} (${n} 条)`,
    metrics: {
      literalKeyed: literalCount, deadKeys: deadKeys.length, deadRatio,
      indexSaved: indexSaved.length, coverage, indirectKeys: indirectKeys.length, chainedKeys: chainedKeys.length,
      regexKeyed: regexed.length, unreachableRegex: unreachableRegex.length,
      thin: thin.length, tokenSwallow: tokenSwallow.length,
      bareFail: bareFail.length, bareWarn: bareWarn.length, bareUnknown: bareUnknown.length,
      fog: {
        tenseDrift: tenseDrift.length, numberedSched: numberedSched.length,
        endgameInConst: endgameInConst.length, dateMarks: dateMarks.length,
        dupFacts: dupFacts.length,
      },
      position: {
        dist: Object.fromEntries(posDist), missing: posMissing,
        staticAtDepth: staticAtDepth.length, ruleAtDepth: ruleAtDepth.length,
      },
    },
    summary, ok, findings,
    deadKeyList: deadKeys.map((e) => ({ comment: e.comment, keys: e.keys, order: e.order })),
    thinList: thin.map((x) => ({ comment: x.e.comment, cjk: x.n, median: x.med, cat: x.cat })),
    deadFields: dead,
    tenseDriftList: tenseDrift.slice(0, 30),
    numberedSchedList: numberedSched.slice(0, 30),
    endgameInConstList: endgameInConst.slice(0, 30),
    dateMarkList: dateMarks.slice(0, 30),
    dupFactList: dupFacts.map(([t, cs]) => ({ text: t.slice(0, 60), comments: cs })),
    staticAtDepthList: staticAtDepth.map((e) => e.comment),
    ruleAtDepthList: ruleAtDepth.map((e) => e.comment),
  }, null, 1));
  process.exit(ok ? 0 : 1);
}

const W = 84; const line = (c = '─') => console.log(c.repeat(W));
const ICON = { pass: '✅', warn: '⚠️ ', fail: '❌' };
console.log('');
line('═');
console.log(`  闸门报告 · ${data.name || '(无名)'}${SEGMENT != null ? ` · 第 ${SEGMENT} 段` : ''}`);
console.log(`  来源 ${source}   检查 ${n} 条${SEGMENT == null ? `（全卡 ${all.length}）` : `（全卡 ${all.length}，共 ${segments.length} 段）`}`);
console.log(`  判定  通过 ${summary.pass} / 警告 ${summary.warn} / 失败 ${summary.fail}   →  ${ok ? '可进入下一段' : '未过闸门'}`);
line('═');
for (const f of findings) {
  console.log('');
  console.log(`  ${ICON[f.level]} ${f.label}`);
  console.log(`     ${f.detail}`);
  if (f.level !== 'pass') console.log(`     → ${f.fix}`);
}
if (deadKeys.length && SHOW > 0) {
  console.log(''); line();
  console.log(`  死键明细（前 ${Math.min(SHOW, deadKeys.length)} / ${deadKeys.length}）：`);
  for (const e of deadKeys.slice(0, SHOW)) {
    console.log(`     [order ${String(e.order).padStart(6)}] ${(e.comment || '(无名)').slice(0, 36).padEnd(38)} ${e.keys.slice(0, 3).join(' / ')}`);
  }
}
if (thin.length && SHOW > 0) {
  console.log(''); line();
  console.log(`  过薄明细（前 ${Math.min(SHOW, thin.length)} / ${thin.length}）：`);
  for (const x of thin.slice(0, SHOW)) {
    console.log(`     ${String(x.n).padStart(5)} 字 / 中位 ${String(x.med).padStart(5)}   ${x.cat.padEnd(10)} ${(x.e.comment || '').slice(0, 34)}`);
  }
}
console.log(''); line('═'); console.log('');
process.exit(ok ? 0 : 1);
