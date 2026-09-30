#!/usr/bin/env node
/**
 * regex-doctor.mjs — 正则 UI 体检
 *
 * 来源：审计了用户 2026-09-23 上传的《RP-Hub 正则 UI - 正文容器异常检修报告.md》。
 * 该报告的核心假设（零长匹配导致 HTML 开场前被插入空 div）已用 RP-Hub 真实源码链
 * 逐字复刻验证 —— 见 references/regex-ui-audit.md。结论：假设成立。
 *
 * 本脚本把这个结论变成可批量执行的检查，并对报告的方案补齐一个漏掉的边界。
 *
 * 用法：
 *   node regex-doctor.mjs <card.png> [--json]
 *   node regex-doctor.mjs --scan-dir <卡所在目录>          # 批量体检整个目录
 */
import { loadCard, unwrap } from './rphub-card.mjs';
import fs from 'node:fs';
import path from 'node:path';

// ── 复刻 core-utils.js L278 的受保护内容正则（逐字）────────────────────
const PROTECTED = /(<!DOCTYPE html>[\s\S]*?<\/html>|<html\b[^>]*>[\s\S]*?<\/html>|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!DOCTYPE html>[\s\S]*$|<html\b[^>]*>[\s\S]*$|<script\b[^>]*>[\s\S]*$|<style\b[^>]*>[\s\S]*$|<ui_template_updates\b[^>]*>[\s\S]*?(?:<\/ui_template_updates>|$)|<!--[\s\S]*?(?:-->|$)|```[\s\S]*?```|```[\s\S]*$|`[^`]+`|<\/?[a-zA-Z][\w:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>)/gi;

function splitProtectedText(text) {
  const source = String(text || '');
  const parts = []; let last = 0; let m;
  const re = new RegExp(PROTECTED.source, PROTECTED.flags);
  while ((m = re.exec(source)) !== null) {
    if (m.index > last) parts.push({ text: source.slice(last, m.index), protected: false });
    parts.push({ text: m[0], protected: true });
    last = m.index + m[0].length;
    if (!m[0]) re.lastIndex += 1;
  }
  if (last < source.length) parts.push({ text: source.slice(last), protected: false });
  return parts;
}
const transformUnprotectedText = (text, fn) =>
  splitProtectedText(text).map((p) => (p.protected ? p.text : fn(p.text))).join('');

/** 复刻 app.js applyDisplayRegex 对单条正则的执行分支 */
export function applyOneRegex(input, regexPattern, replacement) {
  let flags = 'g';
  let pattern = String(regexPattern || '');
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const last = pattern.lastIndexOf('/');
    const pf = pattern.substring(last + 1);
    if (/^[gimsuy]*$/.test(pf)) { flags = pf; pattern = pattern.substring(1, last); }
  }
  const re = new RegExp(pattern, flags);
  // 普通正则保护 HTML/代码（app.js L3247）
  if (!/[<>]/.test(pattern) && !pattern.includes('```')) {
    const wholeMatch = re.exec(input); re.lastIndex = 0;
    const wrapped = wholeMatch?.[0] === input ? input.replace(re, replacement) : null;
    re.lastIndex = 0;
    return wrapped !== null && wrapped.includes(input)
      ? wrapped
      : transformUnprotectedText(input, (part) => part.replace(re, replacement));
  }
  return input.replace(re, replacement);
}

/** 复刻 runtime-services.js renderMarkdown 的 HTML 分支（L112-136） */
export function renderSplit(processed) {
  const trimmed = String(processed || '').trim();
  const htmlMatch = trimmed.match(/(<!doctype html>|<html\b[^>]*>)/i);
  if (htmlMatch && !trimmed.includes('```')) {
    const start = htmlMatch.index;
    const closeTag = '</html>';
    const closeIndex = trimmed.toLowerCase().lastIndexOf(closeTag);
    const hasClose = closeIndex !== -1 && closeIndex > start;
    const end = hasClose ? closeIndex + closeTag.length : trimmed.length;
    const preText = trimmed.substring(0, start);
    return { mode: 'iframe', preText, emptyPreTextNode: isBlankHtmlNode(preText) };
  }
  return { mode: 'markdown', preText: '', emptyPreTextNode: false };
}

/** preText 是否只剩"占位空节点"（有标签无文字）—— 就是用户看到的空容器 */
export function isBlankHtmlNode(html) {
  const stripped = String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return /<[a-zA-Z]/.test(String(html || '')) && stripped === '';
}

// ── 检查项 ─────────────────────────────────────────────────────────────
const MD_CASES = [
  ['纯正文', '这是普通正文。\n\n第二段正文。', true],
  ['纯HTML·行首', '<!DOCTYPE html>\n<html>\n<body>UI</body>\n</html>', false],
  ['正文+HTML', '这里是一段普通正文。\n\n<!DOCTYPE html>\n<html>\n<body>UI</body>\n</html>', true],
  ['HTML前有换行', '\n\n<!DOCTYPE html>\n<html>\n<body>UI</body>\n</html>', false],
  ['HTML前有空格', '     \n<!DOCTYPE html>\n<html>\n<body>UI</body>\n</html>', false],
  ['无DOCTYPE的HTML', '<html>\n<body>UI</body>\n</html>', false],
  ['正文+无DOCTYPE的HTML', '一段正文。\n\n<html>\n<body>UI</body>\n</html>', true],
  ['纯空白', '   \n  ', false],
  ['XML声明开头', '<?xml version="1.0"?>\n<html></html>', false],
];

/** 一条正文外壳正则是否安全 */
export function auditWrapper(regex, replacement) {
  const zeroLen = /\[\\s\\S\]\*\?/.test(regex) || /\[\^[^\]]*\]\*\?/.test(regex);
  const guardsDoctype = /\(\?![^)]*DOCTYPE/i.test(regex);
  const guardsHtml = /\(\?![^)]*(?:<!DOCTYPE|\\?<html|doctype)/i.test(regex);
  // 守卫是"锚定行首"（只排除以 HTML 开头的消息）还是"全串任意位置"（会连正文+HTML 一起排除）
  const guardIsAnchored = /\(\?!\s*(?:<!DOCTYPE|\\?<html|\\<\?xml)/i.test(regex);
  const buildsWrapper = /<(div|section|article|span|p)\b/i.test(replacement) && /\$1/.test(replacement);

  const emptyNode = [];   // 危险：HTML 前出现只有标签没有文字的空节点
  const noWrap = [];      // 质量：纯正文/正文+HTML 没被包裹，美化失效
  for (const [name, input, expectWrapper] of MD_CASES) {
    let out;
    try {
      out = applyOneRegex(input, regex, replacement);
    } catch (e) {
      emptyNode.push({ case: name, reason: `正则无法执行: ${e.message}` });
      continue;
    }
    const hasWrapper = /<(div|section|article|span|p)\b/i.test(out);
    const { emptyPreTextNode } = renderSplit(out);
    if (emptyPreTextNode) {
      emptyNode.push({ case: name, reason: 'HTML 前被插入「只有标签没有文字」的空节点 —— 就是用户看到的空容器' });
      continue;
    }
    if (expectWrapper && !hasWrapper) {
      // 注意：这是「作者守卫选择」而非缺陷。守卫用 [\s\S]* 全串匹配（如某张卡的
      // data-git-setup|git-story-shell|<!doctype|<html），只要有 HTML 就整条跳过包裹。
      // 目的是幂等（避免重复套壳）+ 让 AI 自带的完整 HTML 自己渲染。
      // 代价：正文+HTML 的消息里，正文失去容器样式。是否可接受取决于卡的玩法，故只作观察项。
      noWrap.push({ case: name, reason: '该场景正文未套容器（守卫全串匹配，见 guardIsAnchored）—— 作者可能是有意为之' });
    }
  }
  return {
    zeroLen, guardsDoctype, guardsHtml, guardIsAnchored, buildsWrapper,
    emptyNode, noWrap,
    fails: emptyNode,        // 只有"空容器"算坏 —— 这是用户报的那个 bug
    warnings: noWrap,        // 未包裹 = 行为观察，不判缺陷（见上）
    // 缺陷与否的唯一判据。警告不算缺陷 —— 曾因把 warnings 也当 finding
    // 导致「打印 ❌ 但 --json 里 fails 为空」且 exit=1 的假失败。
    hasFatal: emptyNode.length > 0,
  };
}

// ── 取一条卡的正则脚本 ─────────────────────────────────────────────────
export function regexScripts(card) {
  const { data, ext } = unwrap(card);
  const list = ext.regex_scripts || data.regex_scripts || [];
  return Array.isArray(list) ? list : [];
}

// ── 主流程（仅在直接执行时运行；被 import 时只导出函数）─────────────────
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (!isMain) { /* 被 import：不执行 CLI */ } else {
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const scanDir = (() => { const a = args.find((x) => x.startsWith('--scan-dir=')); return a ? a.split('=')[1] : null; })();
const file = args.find((a) => !a.startsWith('--'));

function checkCard(p) {
  const { card, source } = loadCard(p);
  const d = card.data || card;
  const scripts = regexScripts(card);
  const findings = [];
  for (const s of scripts) {
    const regex = String(s.regex || s.findRegex || '');
    const replacement = String(s.replacement ?? s.replaceString ?? '');
    if (!regex) continue;
    const isWrapper = /^\s*\^/.test(regex) && /<(div|section|article|span|p)\b/i.test(replacement) && /\$1/.test(replacement);
    if (!isWrapper) continue;
    const a = auditWrapper(regex, replacement);
    if (a.hasFatal || a.warnings.length) {
      findings.push({
        name: s.name || s.scriptName || '(无名)', regex: regex.slice(0, 120),
        fails: a.fails, warnings: a.warnings, zeroLen: a.zeroLen,
        guardsHtml: a.guardsHtml, guardIsAnchored: a.guardIsAnchored,
        hasFatal: a.hasFatal,
      });
    }
  }
  return { path: p, name: d.name || '(无名)', source, scripts: scripts.length, findings };
}

function* walk(dir, depth = 0) {
  if (depth > 4) return;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (/\.(png|json)$/i.test(e.name)) yield p;
  }
}

if (scanDir) {
  const results = []; let cards = 0; let totalScripts = 0; let wrappers = 0; let bad = 0;
  for (const p of walk(scanDir)) {
    let r; try { r = checkCard(p); } catch { continue; }
    if (!r.scripts) continue;
    cards++; totalScripts += r.scripts;
    for (const s of r.scripts ? [] : []) void s;
    wrappers += r.findings.length ? 0 : 0;
    if (r.findings.some((f) => f.hasFatal)) { bad++; results.push(r); }
  }
  // 重新统计 wrapper 总数（需要逐条判断，不只看有问题的）
  let wrapperTotal = 0; let wrapperBad = 0; let wrapperWarn = 0;
  const warnList = [];
  const badList = [];
  for (const p of walk(scanDir)) {
    let card; try { ({ card } = loadCard(p)); } catch { continue; }
    const d = card.data || card;
    const scripts = regexScripts(card);
    for (const s of scripts) {
      const regex = String(s.regex || s.findRegex || '');
      const replacement = String(s.replacement ?? s.replaceString ?? '');
      if (!regex || !/^\s*\^/.test(regex)) continue;
      if (!/<(div|section|article|span|p)\b/i.test(replacement) || !/\$1/.test(replacement)) continue;
      wrapperTotal++;
      const a = auditWrapper(regex, replacement);
      if (a.fails.length) { wrapperBad++; badList.push({ file: path.basename(p), card: d.name, name: s.name || s.scriptName, fails: a.fails, warnings: a.warnings, regex: regex.slice(0, 110) }); }
      else if (a.warnings.length) { wrapperWarn++; warnList.push({ card: d.name, name: s.name || s.scriptName, warnings: a.warnings }); }
    }
  }
  if (asJson) {
    console.log(JSON.stringify({ cards, totalScripts, wrapperTotal, wrapperBad, badList }, null, 1));
    process.exit(wrapperBad ? 1 : 0);
  }
  console.log('');
  console.log('  正则 UI 批量体检 ·', scanDir);
  console.log('  ─'.repeat(42));
  console.log(`  扫过带正则的卡 ${cards} 张 / 正则 ${totalScripts} 条`);
  console.log(`  其中「正文外壳」类（锚定 + 造 HTML 包裹 + 用 $1）: ${wrapperTotal} 条`);
  console.log(`  ${wrapperBad ? '❌' : '✅'} 产生空容器（危险）: ${wrapperBad} 条`);
  console.log(`  ℹ️  正文未包裹（作者的守卫选择，非缺陷）: ${wrapperWarn} 条`);
  for (const w of warnList.slice(0, 5)) console.log(`     ℹ️  ${w.card} → ${w.name}`);
  for (const b of badList.slice(0, 15)) {
    console.log(`\n  ■ ${b.card || b.file} → ${b.name}`);
    console.log(`     ${b.regex}`);
    for (const f of b.fails) console.log(`     · [${f.case}] ${f.reason}`);
  }
  console.log('');
  process.exit(wrapperBad ? 1 : 0);
}

if (!file) { console.error('用法: node regex-doctor.mjs <card.png> [--json] | --scan-dir=<dir>'); process.exit(2); }
const r = checkCard(file);
const fatal = r.findings.filter((f) => f.hasFatal);
const warned = r.findings.filter((f) => !f.hasFatal);
if (asJson) {
  console.log(JSON.stringify({ ...r, fatal: fatal.length, warned: warned.length }, null, 1));
  process.exit(fatal.length ? 1 : 0);
}
console.log('');
console.log(`  正则 UI 体检 · ${r.name}   来源 ${r.source}   正则 ${r.scripts} 条`);
console.log('  ─'.repeat(42));
if (!r.findings.length) console.log('  ✅ 所有正文外壳正则都通过 9 项边界测试（含空容器、无DOCTYPE、XML声明）');
else {
  for (const f of fatal) {
    console.log(`\n  ❌ ${f.name}`);
    console.log(`     ${f.regex}`);
    for (const x of f.fails) console.log(`     · [${x.case}] ${x.reason}`);
  }
  for (const f of warned) {
    console.log(`\n  ℹ️  ${f.name}  （未包裹，非缺陷）`);
    console.log(`     ${f.regex}`);
    for (const x of f.warnings) console.log(`     · [${x.case}] ${x.reason}`);
  }
  console.log('');
  console.log(`  合计：空容器（危险）${fatal.length} 条 / 未包裹（观察）${warned.length} 条`);
}
console.log('');
process.exit(fatal.length ? 1 : 0);

}
