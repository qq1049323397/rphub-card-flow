#!/usr/bin/env node
/**
 * doc-lint.mjs — 锁住设计规范层的验收标准
 *
 * 依据：本 skill 的平台无关设计规范层（references/design-principles.md §8）
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

console.log('\n  [7] 主线/写作规则文档（v0.4.0 新增）');
{
  const ML = path.join(REF, 'mainline-trigger.md');
  const WR = path.join(REF, 'worldbook-writing-rules.md');
  const KD = path.join(REF, 'keyword-design.md');
  const ml = read(ML);
  const wr = read(WR);
  const kd = read(KD);

  t('mainline-trigger.md 存在', ml.length > 0);

  // 原理三要素：产出者 / 每轮 / 逐字
  t('主线文档写了产出者条目', /产出者/.test(ml));
  t('主线文档写了「每轮」', /每轮/.test(ml));
  t('主线文档强调逐字对齐', /逐字/.test(ml));
  // 关键校正：推进靠收尾事实而非轮数
  t('主线文档区分收尾事实与轮数', /收尾事实/.test(ml) && /轮数/.test(ml));
  // 必须分流，避免给无主线的卡硬加
  t('主线文档先分流（不需要主线的卡）', /不需要|分流/.test(ml));
  // 小卡也要能做
  t('主线文档覆盖小卡缩配', /小卡/.test(ml));

  // SKILL.md 必须指到新文档
  t('SKILL.md 引用 mainline-trigger.md', skill.includes('mainline-trigger.md'));
  t('SKILL.md 引用 keyword-design.md', skill.includes('keyword-design.md'));

  // 写作规则新增内容组织节，且不含平台专有字段名
  t('写作规则含内容组织节', /内容组织/.test(wr));
  t('写作规则含正向事实写作', /正向/.test(wr));
  {
    const FORBIDDEN = ['RP-Hub', 'SillyTavern', '酒馆', 'variableState', 'uiTemplate',
      'rp_hub_ui_templates', 'markdownOnly', 'promptOnly', 'triggerSlash', 'useRegex',
      'scanDepth', 'matchWholeWords', 'data-arcadia-state'];
    // 写作规则与主线文档都允许出现 RP-Hub（它们是平台侧文档）；
    // 但 design-principles.md 必须保持平台无关（[2] 已管）。
    // 这里只锁：写作规则的第九节不得引入新的平台专有字段名。
    const sec9 = wr.split('## 九、内容组织')[1] || '';
    const hits = FORBIDDEN.filter((w) => w !== 'RP-Hub' && w !== 'SillyTavern' && w !== '酒馆' && sec9.includes(w));
    t('写作规则 §9 未引入平台专有字段名', hits.length === 0, `命中: ${hits.join(', ')}`);
  }

  // ── 2026-09-30 关键校正：卡内正则不会吃掉令牌 ──────────────────────
  // 早先版本采信外来资料，写了「承接正则必须保留 $1」。经源码验证这是错的：
  // 卡内正则只作用于渲染那一份，从不写回 chatHistory。必须锁住新说法。
  t('主线文档否定了「正则吞令牌」旧说法', /卡内正则不会吃掉阶段行/.test(ml));
  t('主线文档区分隐藏与删除', /美化里不显示/.test(ml) && /触发不了/.test(ml));
  t('主线文档点名 markdownOnly 会被 prompt 路径跳过', /isPrompt && userOnly/.test(ml));
  t('主线文档给出真正会改写的机制（文风过滤）', /文风过滤/.test(ml));
  t('主线文档列出过滤禁用词', /极其/.test(ml) && /像在/.test(ml));
  t('主线文档不再要求承接正则保留 $1', !/承接正则必须保留/.test(ml));
  t('keyword-design 不再教「$1 保留」', !/令牌键必须验/.test(kd));
  t('key-reachability 已把该条标为不成立', /前提错，结论不成立/.test(read(path.join(REF, 'key-reachability.md'))));
  t('SKILL.md 载明卡内正则不吃关键词', /卡内正则不会吃掉关键词/.test(skill));

  // 无递归但无上限的校正必须落到 keyword-design.md
  t('keyword-design.md 已补「无递归但无上限」', /无上限/.test(kd) && /无递归/.test(kd));
}

console.log('\n  [8] 卡型分流与小卡工艺（v0.5.0 新增）');
{
  const CE = path.join(REF, 'card-engineering.md');
  const CC = path.join(REF, 'character-craft.md');
  const ce = read(CE);
  const cc = read(CC);

  // 两份公开文档必须存在且可独立使用
  t('card-engineering.md 存在', ce.length > 0);
  t('character-craft.md 存在', cc.length > 0);

  // 公开的两份不得含成人向体裁词（否则会把公开仓变成成人向仓库）
  {
    // ⚠️ 这是一份**内容边界词表**，纯用于 lint 断言，本身不是内容。
    // 它必须内联：干净包（公开仓）里没有 extras/，无法从别处推导。
    // 用正则而非 includes：「触发情境」/「一次性描写」这类子串不算命中。
    const ADULT = [
      /性事/, /交合/, /高潮/, /淫水/, /肉卡/, /性反应/, /体位/, /插入/, /情色/,
      /敏感区/, /乳头/, /阴部/, /性癖/, /突然发情/, /精液/, /话术库/, /呻吟/,
      /性器官/, /(?<!次)性描写/, /前戏/, /射精/, /勃起/, /阴道/, /子宫/,
    ];
    for (const [name, body] of [['card-engineering.md', ce], ['character-craft.md', cc]]) {
      const hits = ADULT.filter((re) => re.test(body)).map(String);
      t(`${name} 不含成人向体裁词`, hits.length === 0, `命中: ${hits.join(', ')}`);
    }
  }

  // 公开的两份不得引用外部卡/文件 —— 这是「绝不去找不存在的卡」的硬保证
  {
    const DANGLING = [/本卡/, /椎名/, /夕凪/, /慕诗雨/, /林欣颖/,
      /\.doc\b/, /\.html\b/, /\.png\b/, /docs\//];
    for (const [name, body] of [['card-engineering.md', ce], ['character-craft.md', cc]]) {
      const hits = DANGLING.filter((re) => re.test(body)).map(String);
      t(`${name} 无外部卡/文件引用`, hits.length === 0, `命中: ${hits.join(', ')}`);
    }
  }

  // 两份都必须显式声明「范例已内嵌、不要去找」
  t('card-engineering 声明范例自足', /不要去找/.test(ce));
  t('character-craft 声明范例自足', /不要去找/.test(cc));

  // 条件指针：extras 不存在必须静默跳过
  t('card-engineering 载明 extras 缺失即跳过', /跳过/.test(ce));
  t('character-craft 载明 extras 缺失即跳过', /跳过/.test(cc));

  // SKILL.md 必须做卡型分流，并把小卡工艺挂上去
  t('SKILL.md 有卡型分流', /卡型分流/.test(skill));
  t('SKILL.md 区分小卡与大世界', /小卡/.test(skill) && /大世界/.test(skill));
  t('SKILL.md 警告大卡别套小卡工艺', /注意力竞争/.test(skill));
  t('SKILL.md 引用 card-engineering.md', skill.includes('card-engineering.md'));
  t('SKILL.md 引用 character-craft.md', skill.includes('character-craft.md'));
  t('SKILL.md 说明 extras 条件读取', /extras\/adult-craft\.md/.test(skill));

  // 悬空引用必须已修掉：世界书规则不得再指向包外 docs/
  t('写作规则不再指向包外 docs/', !read(path.join(REF, 'worldbook-writing-rules.md')).includes('docs/写作方法论'));
  t('写作规则改指 character-craft.md', read(path.join(REF, 'worldbook-writing-rules.md')).includes('character-craft.md'));
}

console.log('\n  [9] 全包无悬空引用 / 无本机私有信息（v0.5.0 新增）');
{
  // 遍历整个包（排除 node_modules），逐文件查「收件人不该看到」的东西。
  // 收件人拿到的是一份自足的 skill：任何指向包外路径的引用都会让人白找一趟。
  const ROOT = path.resolve(HERE, '..');
  const SKIP = new Set(['node_modules', '.git']);
  const SELF = path.join(HERE, 'doc-lint.mjs'); // 本文件含断言字面量，须排除

  const walk = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, acc);
      else acc.push(p);
    }
    return acc;
  };

  const files = walk(ROOT).filter((p) => /\.(md|mjs|js|json|txt)$/.test(p) && p !== SELF);

  // ① 悬空引用：包外路径前缀。/tmp/ 允许（运行期临时文件）；
  //    runtime-facts.md 的 /tmp/rphub-src 是「怎么重拉源码」的配方，属正常。
  const DANGLING = [
    { re: /docs\/superpowers/, why: '内部规格路径' },
    { re: /docs\/写作方法论/, why: '包外文档路径' },
    { re: /\/home\/[a-z]+\//, why: '本机绝对路径' },
    { re: /\/Users\/[a-z]+\//, why: '本机绝对路径' },
  ];
  const danglingHits = [];
  for (const p of files) {
    const body = fs.readFileSync(p, 'utf8');
    for (const { re, why } of DANGLING) {
      if (re.test(body)) danglingHits.push(`${path.relative(ROOT, p)}(${why})`);
    }
  }
  t('全包无悬空引用', danglingHits.length === 0, `命中: ${danglingHits.join(', ')}`);

  // ② 本机私有信息不得外泄
  const PRIVATE = [
    { re: /\/home\/ubuntu/, why: '本机家目录' },
    { re: /RP-Hub\/[a-z]/, why: '本机工作目录' },
  ];
  const privateHits = [];
  for (const p of files) {
    const body = fs.readFileSync(p, 'utf8');
    for (const { re, why } of PRIVATE) {
      if (re.test(body)) privateHits.push(`${path.relative(ROOT, p)}(${why})`);
    }
  }
  t('全包无本机私有路径', privateHits.length === 0, `命中: ${privateHits.join(', ')}`);
}

console.log('\n  [10] 不得引用不存在的卡 / 文档不得要求读者去找卡（v0.6.0 新增）');
{
  // 这个 skill 会整包发给别人。收件人手里**只有这份 skill，没有我们的任何卡**。
  // 所以文档里出现一个具体的卡名/工作目录名，就是在让人去找一个不存在的东西，
  // 白跑一趟还以为是 skill 坏了。这类引用必须全部改写成方法描述。
  const ROOT = path.resolve(HERE, '..');
  const SKIP = new Set(['node_modules', '.git']);
  const SELF = path.join(HERE, 'doc-lint.mjs');

  const walk = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, acc);
      else acc.push(p);
    }
    return acc;
  };

  const files = walk(ROOT).filter((p) => /\.(md|mjs|js|json|txt)$/.test(p) && p !== SELF);

  // ① 内部工作目录代号 / 某张卡内部的文件名：我们自己的组织方式，收件人没有。
  const PHANTOM = [
    { re: /project\s*\d+/i, why: '内部工作目录代号，收件人不存在此卡' },
    { re: /[\w\u4e00-\u9fa5·-]{2,}\.wb\b/, why: '某张卡内部的世界书文件名' },
  ];
  const phantomHits = [];
  for (const p of files) {
    const body = fs.readFileSync(p, 'utf8');
    for (const { re, why } of PHANTOM) {
      if (re.test(body)) phantomHits.push(`${path.relative(ROOT, p)}(${why})`);
    }
  }
  t('全包不引用内部工作目录代号', phantomHits.length === 0, `命中: ${phantomHits.join(', ')}`);

  // ② 骨架一致性必须写进文档：同类条目小节顺序固定，否则等于没给标准。
  const wbRules = read(path.join(REF, 'worldbook-writing-rules.md'));
  t('写作规则含六类条目骨架', /六类条目的标准骨架/.test(wbRules));
  t('骨架给出人物完整版与精简版', /人物类 · 完整骨架/.test(wbRules) && /人物类 · 精简骨架/.test(wbRules));
  t('骨架给出事件类', /事件类 · 标准骨架/.test(wbRules));
  t('骨架解释 最易误解', /最易误解/.test(wbRules));
  t('骨架解释 决策优先顺序', /决策优先顺序/.test(wbRules));
  t('骨架解释 关键关系带边界', /关键关系带边界/.test(wbRules));
  t('骨架警告大卡常驻规模不可套小卡', /小卡照抄会直接爆预算/.test(wbRules));
  t('骨架字段用中性词（不写作品专有名词）', /等级或评级/.test(wbRules) && !/言灵|血统等级/.test(wbRules));

  // ③ 阶段交接机制必须成文，大卡与小卡两档都要有。
  const ml = read(path.join(REF, 'mainline-trigger.md'));
  t('主线文档含阶段交接', /阶段之间的交接/.test(ml));
  t('交接写明下一阶段名称', /下一阶段名称/.test(ml));
  t('交接写明下一阶段入口', /下一阶段入口/.test(ml));
  t('交接给出小卡一行压缩写法', /小卡版：一行就够/.test(ml));
  t('交接强调键名逐字对齐', /逐字相同/.test(ml));
  t('交接说明无下一幕就不写', /不需要这两行/.test(ml));
  t('交接声明来源但不复制文案', /不复制该卡的任何文案/.test(ml));

  // ④ 平台自带契约（时间戳）必须进关键词文档，并说清"成立的是机制不是词类"。
  const kw = read(path.join(REF, 'keyword-design.md'));
  t('关键词文档含平台自带契约一档', /平台自带契约/.test(kw));
  t('关键词文档给出载体无关判据', /有东西保证它每轮出现/.test(kw));
  t('关键词文档警告个案巧合不可当规范', /把个案的巧合写成规范/.test(kw));

  // ⑤ 致谢必须落到文档里（用户明确要求）。
  t('SKILL.md 致谢娜娜米/ArC', /娜娜米/.test(skill) && /ArC/.test(skill));
  t('SKILL.md 致谢酒馆预设方法论', /酒馆/.test(skill) && /预设/.test(skill));
  t('SKILL.md 声明边界：只要骨架不要文案', /不复制任何卡的文案内容/.test(skill));
  t('写作规则也含致谢', /ArC 超越之影/.test(wbRules) && /娜娜米喵/.test(wbRules));

  // ⑥ 版本号只声明一处，且 SKILL.md 与 README 不许各说各的。
  // 版本号不写死在这里 —— 写死等于每次升版本都要改测试，是测试在拖版本走。
  const verRe = /^version:\s*"([^"]+)"/m;
  const verHits = files
    .map((p) => ({ p, v: (fs.readFileSync(p, 'utf8').match(verRe) || [])[1] }))
    .filter((x) => x.v);
  t('版本号只声明一处', verHits.length === 1,
    verHits.length ? `命中 ${verHits.length} 处：${verHits.map((x) => path.relative(ROOT, x.p)).join(', ')}` : '一处都没有');
  const declared = verHits[0]?.v;
  t('SKILL.md 声明的版本与 README 一致',
    !!declared && new RegExp(`v${declared.replace(/\./g, '\\.')}`).test(read(path.join(ROOT, 'README.md'))),
    `SKILL.md=${declared}`);

  // ⑦ 裸名保底（v0.7.0）：铁律要落到主文档与规则文档，函数要真的导出。
  t('SKILL.md 声明裸名保底铁律', /裸名保底/.test(skill) && /存在一个键 ⊆ 裸名/.test(skill));
  t('SKILL.md 含命名期步骤', /第 0\.5 步：定裸名/.test(skill));
  t('SKILL.md 反模式含前缀键', /只写「前缀 \+ 名字」当键/.test(skill));
  const kwDesign = read(path.join(REF, 'keyword-design.md'));
  t('关键词文档含裸名小节', /裸名保底/.test(kwDesign) && /键 ⊆ 裸名/.test(kwDesign));
  const cardMod = fs.readFileSync(path.join(ROOT, 'scripts', 'rphub-card.mjs'), 'utf8');
  t('rphub-card.mjs 导出裸名判定', /export function extractBareName/.test(cardMod)
    && /export function checkBareNameGuard/.test(cardMod));
  const gateMod = fs.readFileSync(path.join(ROOT, 'scripts', 'gate.mjs'), 'utf8');
  t('gate.mjs 接入裸名保底检查项', /bare-name-guard/.test(gateMod));
}

console.log('\n  ' + '─'.repeat(60));
console.log(`  通过 ${pass} / 失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
