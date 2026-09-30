import { loadCard, entries, cjkCount } from '../scripts/rphub-card.mjs';
import path from 'node:path';

// 卡路径从命令行给，脚本内不写死任何卡 —— 这个包要能发给别人，
// 绝不能去摸一张只在本机存在（或早已被删）的卡。
const cards = process.argv.slice(2).map((p) => [path.basename(p), p]);
if (!cards.length) {
  console.error('用法: node tests/keylen.mjs <card.png|card.json> [...更多卡]');
  process.exit(2);
}
for (const [name, p] of cards) {
  let card, es;
  try { ({ card } = loadCard(p)); es = entries(card); } catch (e) { console.log(name, '读取失败', e.message); continue; }
  // 卡面 + 常驻正文 = A级文本源
  const d = card.data || card;
  const face = ['description','personality','scenario','first_mes','mes_example','system_prompt','post_history_instructions']
    .map(k => d[k]).filter(Boolean).join('\n');
  const constText = es.filter(e => e.constant).map(e => e.content).join('\n');
  const source = face + '\n' + constText;
  // 按键长分桶统计"全卡零出现"比例
  const buckets = { '1字': [0,0], '2字': [0,0], '3-4字': [0,0], '5-6字': [0,0], '7+字': [0,0] };
  let regexKeys = 0;
  for (const e of es) {
    if (e.constant) continue;
    for (const k of (e.keys || [])) {
      if (e.useRegex) { regexKeys++; continue; }
      const len = [...String(k)].length;
      const bk = len === 1 ? '1字' : len === 2 ? '2字' : len <= 4 ? '3-4字' : len <= 6 ? '5-6字' : '7+字';
      buckets[bk][1]++;
      if (source.includes(k)) buckets[bk][0]++;
    }
  }
  console.log('\n■', name, `(${es.length} 条目, 正则键 ${regexKeys} 条已排除)`);
  console.log('  键长      命中率');
  for (const [bk, [hit, tot]] of Object.entries(buckets)) {
    if (!tot) continue;
    const pct = (hit/tot*100).toFixed(1);
    const bar = '█'.repeat(Math.round(hit/tot*20));
    console.log(`  ${bk.padEnd(8)} ${String(hit).padStart(4)}/${String(tot).padEnd(5)} ${pct.padStart(5)}%  ${bar}`);
  }
}
