#!/usr/bin/env node
/**
 * run-tests.mjs — 一键自检
 *
 * 覆盖：
 *   1. 解包优先级（chara 优先于 RoleplayHubCard，与源码一致）
 *   2. 正则 UI 九项边界（危险正则必被抓 / 安全正则必放行）
 *   3. 关键词五档（合成卡的分档必须与人工预期一致）
 *   4. gate.mjs 对缺陷卡必须 exit 1、对好卡必须 exit 0
 *
 * 用法: node tests/run-tests.mjs
 */
import { loadCard, entries } from '../scripts/rphub-card.mjs';
import { auditWrapper, applyOneRegex, renderSplit } from '../scripts/regex-doctor.mjs';
import { writeCardPng, minimalCard, cleanCard } from './fixture.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..', 'scripts');
let pass = 0, fail = 0;
const t = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('\n  rphub-card-flow 自检\n  ' + '─'.repeat(60));

// ── 0. 这个包不许去摸外部的卡 ─────────────────────────────────────────
// 发给别人时，本机上那些卡根本不存在。任何脚本里写死卡路径 = 对方一跑就报错。
// 这条断言把「默认不找外部卡」钉死，防止以后又长回来。
console.log('\n  [0] 不依赖外部卡（可移植性）');
{
  const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.mjs'));
  const hardcoded = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;          // 注释不算
      // 形如 '.../xxx.png' 或 '.../xxx.json' 的字面量路径
      if (/['"][^'"]*\/[^'"]*\.(png|json)['"]/.test(line) && !/tmp|process\.env|argv/.test(line)) {
        hardcoded.push(`${f}:${i + 1}`);
      }
    });
  }
  t('测试脚本内无写死的外部卡路径', hardcoded.length === 0, hardcoded.join(' '));
  t('run-tests 不读环境变量外的真实卡', !/process\.env\.RPHUB_DIR/.test(fs.readFileSync(path.join(HERE, 'fixes.mjs'), 'utf8')));
}

// ── 1. 解包优先级 ──────────────────────────────────────────────────────
// 用现场合成的卡，不再依赖某张真实卡 —— 真实卡会被删/改名，测试不该跟着红。
// 合成卡还能把三个分支都测到，真实卡只有 chara 一个块。
console.log('\n  [1] 解包优先级 chara → ccv3 → 嗅探');
{
  const c = minimalCard();
  const pc = writeCardPng(c, { chunks: ['chara'] });
  const { source, meta } = loadCard(pc);
  t('合成卡从 chara 读出', source === 'png:chara', source);
  t('chara 块存在', meta.chunks.includes('chara'));

  t('ccv3 分支可读', loadCard(writeCardPng(c, { chunks: ['ccv3'] })).source === 'png:ccv3');
  t('嗅探分支可读（原文 JSON）',
    loadCard(writeCardPng(c, { chunks: ['sniff'], sniffKey: 'Comment' })).source === 'png:sniff(Comment)');
  t('嗅探分支可读（base64）',
    loadCard(writeCardPng(c, { chunks: ['sniff'], sniffKey: 'Comment', sniffAs: 'base64' })).source === 'png:sniff(Comment)');
  // chara 必须优先于 ccv3（与源码 findPngCharacterPayload 一致）
  const both = loadCard(writeCardPng(c, { chunks: ['chara', 'ccv3'], ccv3Card: { data: { name: 'ccv3版' } } }));
  t('chara 优先于 ccv3', both.source === 'png:chara' && both.card.data.name === '测试卡', both.card.data.name);
  t('中文往返无损', loadCard(writeCardPng({ ...c, data: { ...c.data, first_mes: '中文[令牌|值]' } })).card.data.first_mes === '中文[令牌|值]');
}

// ── 2. 正则 UI 边界 ────────────────────────────────────────────────────
console.log('\n  [2] 正则 UI 边界');
{
  const REPL = '<div class="正文容器">$1</div>';
  const bad = auditWrapper('^([\\s\\S]*?)(?=<!DOCTYPE|$)', REPL);
  t('危险正则被判定产生空容器', bad.fails.length > 0, `fails=${bad.fails.length}`);

  const md = auditWrapper('^(?!\\s*<!DOCTYPE)([\\s\\S]+?)(?=<!DOCTYPE|$)', REPL);
  t('报告提议版仍漏「无DOCTYPE的html」', md.fails.some((f) => f.case.includes('无DOCTYPE')), `fails=${md.fails.length}`);

  const good = auditWrapper('^(?!\\s*(?:<!DOCTYPE|<\\?xml|<html))(?=\\S)([\\s\\S]*?)(?=(?:<!DOCTYPE|<\\?xml|<html)|$)', REPL);
  t('本插件推荐版全过', good.fails.length === 0, `fails=${good.fails.length}`);

  const authors = auditWrapper('^(?![\\s\\S]*(?:data-git-setup|git-story-shell|<!doctype\\s+html|<html\\b))([\\s\\S]+)$(?=>?)', REPL);
  t('作者的幂等守卫不判缺陷（fails=0）', authors.fails.length === 0, `fails=${authors.fails.length}`);

  // 渲染切分：空节点必须被识别
  const out = applyOneRegex('<!DOCTYPE html>\n<html><body>x</body></html>', '^([\\s\\S]*?)(?=<!DOCTYPE|$)', REPL);
  t('复刻渲染器能识别 preText 空节点', renderSplit(out).emptyPreTextNode === true);
}

// ── 3. 关键词五档 ──────────────────────────────────────────────────────
console.log('\n  [3] 关键词五档（合成卡）');
{
  const synth = {
    data: {
      name: '合成测试卡',
      first_mes: '开场白里提到了 A地点。',
      description: '卡面提到了 B人名。',
      character_book: {
        entries: [
          { comment: '① A档', keys: ['A地点'], content: '内容', order: 10 },
          { comment: '② B档', keys: ['B人名'], content: '内容', order: 20 },
          { comment: '③ S档', keys: ['C组织'], content: '内容', order: 30 },
          { comment: '④ 索引', keys: [], content: '收录 C组织', constant: true, order: 40, position: 'system_top' },
          { comment: '⑤ D档', keys: ['D死词'], content: '内容', order: 50 },
        ],
      },
    },
  };
  const tmp = '/tmp/synth-keycard.json';
  fs.writeFileSync(tmp, JSON.stringify(synth));
  // key-audit 有死键时 exit 1，execFileSync 会抛；这里统一取 stdout
  let out = '';
  try { out = execFileSync('node', [path.join(SCRIPTS, 'key-audit.mjs'), tmp, '--json'], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; }
  let j = null;
  try { j = JSON.parse(out); } catch { /* 留给下面的断言报告 */ }
  if (j) {
    t('A 档 = 1（开场白里的键）', j.tiers.A === 1, `A=${j.tiers.A}`);
    t('B 档 = 1（卡面里的键）', j.tiers.B === 1, `B=${j.tiers.B}`);
    t('S 档 = 1（被常驻索引点名）', j.tiers.S === 1, `S=${j.tiers.S}`);
    t('D 档 = 1（真死键）', j.tiers.D === 1, `D=${j.tiers.D}`);
    t('死键明细含 D死词', (j.dead || []).some((d) => (d.keys || []).includes('D死词')));
  } else t('合成卡 key-audit 可解析', false);
}

// ── 4. gate 退出码 ─────────────────────────────────────────────────────
console.log('\n  [4] gate 退出码');
{
  const run = (f) => { try { execFileSync('node', [path.join(SCRIPTS, 'gate.mjs'), f], { stdio: 'ignore' }); return 0; } catch (e) { return e.status; } };
  if (fs.existsSync('/tmp/regress-card.json')) t('缺陷卡 exit=1', run('/tmp/regress-card.json') === 1);
  // 干净卡必须 exit=0 —— 同样改用合成卡，避免依赖会被删掉的真实卡
  fs.writeFileSync('/tmp/clean-card.json', JSON.stringify(cleanCard()));
  t('干净卡 exit=0', run('/tmp/clean-card.json') === 0, `实际 ${run('/tmp/clean-card.json')}`);
}

// ── 5. 正则吞令牌 ──────────────────────────────────────────────────────
console.log('\n  [5] 正则吞令牌');
{
  const swallow = {
    data: { name: '吞令牌', first_mes: 'x', character_book: { entries: [
      { comment: '① 令牌条目', keys: ['STAT_SET'], content: 'c', order: 10 },
      { comment: '② 常驻', keys: [], content: 'c', constant: true, order: 20 },
    ] } },
    extensions: { regex_scripts: [
      { name: '吞掉', regex: '\\[STAT_SET\\|([^\\]]+)\\]', replacement: '<div>面板</div>' },
      { name: '保留', regex: '\\[OTHER\\|([^\\]]+)\\]', replacement: '<div>$1</div>' },
    ] },
  };
  fs.writeFileSync('/tmp/swallow.json', JSON.stringify(swallow));
  let out = '';
  try { out = execFileSync('node', [path.join(SCRIPTS, 'gate.mjs'), '/tmp/swallow.json'], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; }
  t('检测到吞令牌且只报 1 条', /正则吞令牌 1 条/.test(out), out.match(/正则吞令牌 \d+ 条/)?.[0]);
}

// ── 6. 设计规范层文档契约 ──────────────────────────────────────────────
console.log('\n  [6] 设计规范层文档契约（tests/doc-lint.mjs）');
{
  try {
    execFileSync(process.execPath, [path.join(HERE, 'doc-lint.mjs')], { stdio: 'pipe' });
    t('doc-lint.mjs 全绿', true);
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    const bad = out.split('\n').filter((l) => l.includes('❌')).join(' | ');
    t('doc-lint.mjs 全绿', false, bad || '运行失败');
  }
}

// ── 7. 三缺陷回归 ──────────────────────────────────────────────────────
console.log('\n  [7] 三缺陷回归（tests/fixes.mjs）');
{
  try {
    execFileSync(process.execPath, [path.join(HERE, 'fixes.mjs')], { stdio: 'pipe' });
    t('fixes.mjs 全绿', true);
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    const bad = out.split('\n').filter((l) => l.includes('❌')).join(' | ');
    t('fixes.mjs 全绿', false, bad || '运行失败');
  }
}

console.log('\n  ' + '─'.repeat(60));
console.log(`  通过 ${pass} / 失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
