/**
 * rphub-card.mjs — RP-Hub 卡读取 + 运行时行为复刻
 *
 * 目的：让脚本说的每一句话都和 RP-Hub 真实运行时一致，而不是"看起来对"。
 * 基准源码：RP-Hub 网站源码 @ c52ac9a（只读事实源，随包不含）
 *   - 读取/归一化: assets/js/core-utils.js  normalizeWorldInfoEntry()  (L556-624)
 *   - 导出映射:    assets/js/core-utils.js  toWorldInfoExportEntry()   (L694-708)
 *   - 触发解析:    assets/js/data-services.js resolveWorldInfoEntries() (L581-639)
 *   - key 匹配:    assets/js/data-services.js worldInfoKeyMatchesText() (L568-579)
 *
 * 绝不修改被读的卡。只读。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ── PNG tEXt 读取（RP-Hub 把卡写进 PNG 的 tEXt 块）────────────────────────
export function readPngTextChunks(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('不是 PNG 文件（签名不符）');
  }
  const out = new Map();
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const dataStart = i + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) break;
    if (type === 'tEXt') {
      const data = buf.subarray(dataStart, dataEnd);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const kw = data.toString('latin1', 0, nul);
        out.set(kw, data.subarray(nul + 1));
      }
    }
    i = dataEnd + 4; // 跳过 CRC
    if (type === 'IEND') break;
  }
  return out;
}

/** 从 PNG/JSON 读出卡对象。返回 {card, source, meta} */
export function loadCard(path) {
  if (!existsSync(path)) throw new Error(`找不到文件：${path}`);
  const buf = readFileSync(path);
  const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;

  if (!isPng) {
    const card = JSON.parse(buf.toString('utf8'));
    return { card, source: 'json', meta: { path, bytes: buf.length } };
  }

  const chunks = readPngTextChunks(buf);
  const meta = { path, bytes: buf.length, chunks: [...chunks.keys()] };

  // ⚠ 2026-09-23 修正：优先级必须与 RP-Hub 一致，否则读到的可能不是运行时看到的卡。
  //   core-utils.js L446-453 findPngCharacterPayload():
  //     if (chunks.chara) return chunks.chara;
  //     if (chunks.ccv3)  return chunks.ccv3;
  //     return <第一个像 JSON 的块>;            // 嗅探：trim 后 >50 字符且以 { 或 ey 开头
  //   源码里【没有】RoleplayHubCard 这个键 —— 它已弃用。
  //   本脚本早先写成"RoleplayHubCard 优先"，对同时带两个块的卡会读错：
  //   RoleplayHubCard 是旧导出（未归一化），chara 才是运行时真正解析的那份。
  if (chunks.has('chara')) {
    const card = JSON.parse(Buffer.from(chunks.get('chara').toString('latin1'), 'base64').toString('utf8'));
    return { card, source: 'png:chara', meta };
  }
  if (chunks.has('ccv3')) {
    const card = JSON.parse(Buffer.from(chunks.get('ccv3').toString('latin1'), 'base64').toString('utf8'));
    return { card, source: 'png:ccv3', meta };
  }
  // JSON 嗅探（与源码同条件：trim 后 >50 字符且以 { 或 ey 开头）
  for (const [kw, value] of chunks) {
    const text = value.toString('utf8').trim();
    if (text.length <= 50 || !(text.startsWith('{') || text.startsWith('ey'))) continue;
    try {
      return { card: JSON.parse(text), source: `png:sniff(${kw})`, meta };
    } catch {
      try {
        return { card: JSON.parse(Buffer.from(text, 'base64').toString('utf8')), source: `png:sniff(${kw})`, meta };
      } catch { /* 继续找下一个块 */ }
    }
  }
  throw new Error(`PNG 里没有可解析的角色卡数据（块：${[...chunks.keys()].join(', ') || '无 tEXt'}）`);
}

/** 卡面本体（data 层）与 extensions 层 */
export function unwrap(card) {
  const data = card.data && typeof card.data === 'object' ? card.data : card;
  const ext = (card.extensions && typeof card.extensions === 'object' ? card.extensions : null)
    || (data.extensions && typeof data.extensions === 'object' ? data.extensions : {})
    || {};
  return { data, ext };
}

// ── RP-Hub normalize() 复刻 ────────────────────────────────────────────
const VALID_POSITIONS = new Set([
  'system_top', 'global_note', 'before_char', 'after_char', 'at_depth', 'user_top', 'assistant_top',
]);
const POSITION_ALIASES = {
  before_character: 'before_char', after_character: 'after_char',
  character_top: 'before_char', character_bottom: 'after_char',
  before_examples: 'before_char', after_examples: 'after_char',
  example_top: 'before_char', example_bottom: 'after_char',
  an_top: 'global_note', author_note: 'global_note', an_bottom: 'global_note',
};
const NUMERIC_POSITION = { 0: 'before_char', 1: 'after_char', 2: 'global_note', 3: 'global_note', 4: 'at_depth' };

// 严格对齐 core-utils.js L490-494 的 toNumber：
// undefined / null / '' 一律返回 fallback（不是 0！）。
// 之前写成 Number(null)=0 会让 scanDepth 的 null 被误判成 0。
const toNum = (v, fb) => {
  if (v === undefined || v === null || v === '') return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
const toBool = (v, fb) => {
  if (v === undefined || v === null) return fb;
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'false') return false;
    if (v.toLowerCase() === 'true') return true;
  }
  return !!v;
};

/**
 * 完全按 RP-Hub 的方式归一化一条世界书条目。
 * 返回值 = 运行时真正看到的字段。rawFields 用来报告"写了但读不到"的字段。
 */
export function normalizeEntry(entry = {}) {
  const merged = { ...entry };
  // extensions 会被提升到顶层（core-utils L558-561）
  for (const [k, v] of Object.entries(entry.extensions || {})) {
    if (v !== undefined && v !== null) merged[k] = v;
  }
  delete merged.extensions;

  const pick = (keys, fb) => {
    for (const k of keys) {
      if (merged[k] !== undefined && merged[k] !== null) return merged[k];
    }
    return fb;
  };

  let keys = merged.keys || merged.key || [];
  if (typeof keys === 'string') keys = keys.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  else if (!Array.isArray(keys)) keys = [];
  else keys = keys.map((k) => String(k ?? '').trim()).filter(Boolean);

  let position = 'at_depth';
  const rawPos = merged.position;
  if (typeof rawPos === 'string') {
    const norm = rawPos.toLowerCase().replace(/ /g, '_');
    const mapped = POSITION_ALIASES[norm] || norm;
    if (VALID_POSITIONS.has(mapped)) position = mapped;
  } else if (typeof rawPos === 'number') {
    position = NUMERIC_POSITION[rawPos] || 'at_depth';
  }

  const comment = pick(['comment'], '');
  return {
    comment,
    content: pick(['content'], ''),
    enabled: toBool(pick(['enabled'], true), true) && !toBool(pick(['disable', 'disabled'], false), false),
    keys,
    useRegex: toBool(pick(['use_regex', 'useRegex'], false), false),
    constant: toBool(pick(['constant'], false), false),
    position,
    order: toNum(pick(['insertion_order', 'order'], 0), 0),
    depth: toNum(pick(['depth'], 4), 4),
    scanDepth: toNum(pick(['scan_depth', 'scanDepth'], null), null),
    probability: toNum(pick(['probability'], 100), 100),
    useProbability: toBool(pick(['useProbability', 'use_probability'], true), true),
    scope: pick(['scope'], 'character'),
    _raw: entry,
    _rawFields: Object.keys(entry),
    _extFields: Object.keys(entry.extensions || {}),
  };
}

/** 取世界书原始条目数组（兼容数组 / 对象 / 旧字段） */
export function rawEntries(card) {
  const { data } = unwrap(card);
  const book = data.character_book || card.character_book || null;
  if (!book) return [];
  let e = book.entries;
  if (Array.isArray(e)) return e;
  if (e && typeof e === 'object') return Object.values(e);
  return [];
}

/** 归一化全部条目，并保留原始顺序 */
export function entries(card) {
  return rawEntries(card).filter((e) => e && typeof e === 'object').map(normalizeEntry);
}

// ── 运行时真正会读的字段白名单 ────────────────────────────────────────
// 来自 normalize()（读取）+ toWorldInfoExportEntry()（写回）。两处取并集。
export const RUNTIME_FIELDS = new Set([
  'comment', 'content', 'enabled', 'disable', 'disabled', 'scope',
  'keys', 'key', 'use_regex', 'useRegex', 'constant', 'position',
  'insertion_order', 'order', 'depth', 'scan_depth', 'scanDepth',
  'probability', 'useProbability', 'use_probability',
  'id', 'name', // 允许存在，但不参与判定
]);

/**
 * 找出"写了但运行时读不到"的字段。
 * 注意：extensions 里的同名键会被提升，所以单独算。
 */
export function deadFields(entriesList) {
  const bag = new Map();
  for (const e of entriesList) {
    for (const f of e._rawFields) {
      if (f === 'extensions') continue;
      bag.set(f, (bag.get(f) || 0) + 1);
    }
    for (const f of e._extFields) {
      bag.set('ext::' + f, (bag.get('ext::' + f) || 0) + 1);
    }
  }
  const dead = [];
  for (const [f, n] of bag) {
    if (f.startsWith('ext::')) {
      const inner = f.slice(5);
      // extensions 里的键会被提升到顶层；只有运行时白名单里的键才真的有用
      if (!RUNTIME_FIELDS.has(inner)) dead.push([f, n]);
    } else if (!RUNTIME_FIELDS.has(f)) {
      dead.push([f, n]);
    }
  }
  return dead.sort((a, b) => b[1] - a[1]);
}

// ── 触发行为复刻 ──────────────────────────────────────────────────────
function createRegex(pattern) {
  let source = String(pattern || '');
  let flags = 'i';
  if (source.startsWith('/') && source.lastIndexOf('/') > 0) {
    const last = source.lastIndexOf('/');
    const pf = source.slice(last + 1);
    if (/^[dgimsuvy]*$/.test(pf)) {
      source = source.slice(1, last);
      flags = pf;
    }
  }
  flags = flags.replace(/g/g, '');
  if (!flags.includes('i')) flags += 'i';
  return new RegExp(source, flags);
}

/** 单条 key 是否命中文本（与运行时同语义） */
export function keyMatches(entry, key, text) {
  const k = String(key || '').trim();
  const t = String(text || '');
  if (!k || !t) return false;
  if (!entry.useRegex) return t.toLowerCase().includes(k.toLowerCase());
  try {
    return createRegex(k).test(t);
  } catch {
    return false;
  }
}

export function cjkCount(s) {
  return (String(s ?? '').match(/[\u4e00-\u9fff]/g) || []).length;
}
export function nonSpaceCount(s) {
  return String(s ?? '').replace(/\s/g, '').length;
}
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

/**
 * comment 的命名前缀（"人物·洛琳·金钱观" → "人物"）。
 * 有些作者直接写一整句话当 comment（有的卡就有），那不叫类别名。
 * 超过 MAX 字就归入「（无前缀）」，避免把句子当类别污染统计。
 */
const PREFIX_MAX = 12;
export function commentPrefix(comment) {
  const c = String(comment || '').trim();
  if (!c) return '（无前缀）';
  for (const sep of ['｜', '|', '·', '：', ':', '—', '-', '_', '（', '(', '【', '[', ' ']) {
    const i = c.indexOf(sep);
    if (i > 0) {
      const p = c.slice(0, i).trim();
      return p.length <= PREFIX_MAX ? p : '（无前缀）';
    }
  }
  return c.length <= PREFIX_MAX ? c : '（无前缀）';
}

// ── 裸名保底（v0.7.0）──────────────────────────────────────────────────
// 病因：键是「前缀形态 + 名字」（地点：货运仓库）时，正文只写裸名（货运仓库）
// 匹配不到——键匹配是子串匹配，长键不会被短文本包含。于是条目只在
// 「正好身处此地」那一轮活着，其余轮次全灭。修法是保证 keys 里有裸名本身。

/**
 * 条目裸名：它在正文里的自然称呼。
 * 优先 content 开头的 <标签>（作者自己声明的实体名，最准）；
 * 否则退回 comment 的第二段（三段式只取中间段，避免 "铁砧城·城市档案"）。
 * 取不到返回 null —— 宁可不查，也不用切错的裸名报假问题。
 */
export function extractBareName(entry = {}) {
  const m = String(entry.content || '').match(/^\s*<([^>\n]{1,40})>/);
  if (m) return { bare: m[1].trim(), source: 'content-tag' };
  const c = String(entry.comment || '').trim();
  if (c) {
    const seg = c.split('·').map((s) => s.trim()).filter(Boolean);
    if (seg.length >= 2) return { bare: seg[1], source: 'comment' };
  }
  return { bare: null, source: null };
}

/**
 * 裸名保底：每条非常驻条目，keys 里必须有它的裸名。
 * 判据 = 存在一个键 ⊆ 裸名（含相等）—— 直接复用 keyMatches，
 * 它的字面分支就是 bare.includes(key)，正是这个条件。
 * 长度不参与判定：Corvin 与 黑炎龙武装修罗铠甲 同等通过。
 *
 * 豁免只有两类，别的都不豁免：
 *   · constant 条目 —— 本来就不靠键触发；
 *   · 正则键匹配到常驻枚举值 —— 有输出契约每轮逼 AI 写出那个值。
 * 按「是不是正则」豁免是错的，会漏放「装备X」这类没人养的键。
 */
export function checkBareNameGuard(entry = {}, { constEnumValues = [] } = {}) {
  if (entry.constant) return { tier: 'exempt', reason: '常驻条目不靠键触发' };
  const { bare, source } = extractBareName(entry);
  if (!bare) return { tier: 'unknown', reason: '取不到裸名' };
  const keys = (entry.keys || []).map((k) => String(k).trim()).filter(Boolean);
  if (!keys.length) return { tier: 'unknown', bare, source, reason: '无键' };

  if (entry.useRegex) {
    const hitEnum = keys.some((k) => constEnumValues.some((v) => keyMatches(entry, k, v)));
    if (hitEnum) return { tier: 'exempt', bare, source, reason: '正则匹配常驻枚举值' };
  }

  const covered = keys.filter((k) => keyMatches(entry, k, bare));
  if (!covered.length) return { tier: 'fail', bare, source, keys, reason: '没有键是裸名的子串' };
  // 键严格短于裸名：只在它本身是泛词时才提醒。
  // 「武装·叛逆残刃与斯巴达之剑」用 叛逆残刃 / 斯巴达之剑 做键是正当拆分，
  // 不是「短键」问题；该报的是 仓库 之于 货运仓库 这种泛词风险。
  const shortest = covered.reduce((a, b) => (a.length <= b.length ? a : b));
  if (shortest.length < bare.length && isBroadWord(shortest)) {
    return { tier: 'warn', bare, source, by: shortest, reason: `键「${shortest}」是泛词，可能误触发` };
  }
  return { tier: 'pass', bare, source, by: covered[0] };
}

/**
 * 泛词判定：用于提醒与命名期建议。命中即可能是误触发源。
 * 两类：整体就是类别词的（人物/地点/事件）；极短且以通用场所、物品类后缀结尾的。
 */
const BROAD_WORDS = new Set([
  '人物', '角色', '地点', '场景', '事件', '任务', '系统', '世界',
  '状态', '消息', '剧情', '设定', '规则', '继续', '现在', '情况',
]);
const GENERIC_TAIL = /(?:仓库|教堂|地铁|后院|渡口|商街|工房|铠甲|医院|学校|酒店|公司|公寓|广场|大厅|房间)$/;
export function isBroadWord(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (BROAD_WORDS.has(t)) return true;
  return t.length <= 2 && GENERIC_TAIL.test(t);
}
