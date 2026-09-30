import { loadCard, entries } from '../scripts/rphub-card.mjs';
import path from 'node:path';

// 卡路径从命令行给，脚本内不写死任何卡 —— 这个包要能发给别人，
// 绝不能去摸一张只在本机存在（或早已被删）的卡。
const cards = process.argv.slice(2).map((p) => [path.basename(p), p]);
if (!cards.length) {
  console.error('用法: node tests/ap7.mjs <card.png|card.json> [...更多卡]');
  process.exit(2);
}
for (const [name, p] of cards) {
  let card, es;
  try { ({ card } = loadCard(p)); es = entries(card); } catch { continue; }
  const d = card.data || card;
  const face = ['description','personality','scenario','first_mes','mes_example','system_prompt','post_history_instructions']
    .map(k => d[k]).filter(Boolean).join('\n');
  const constText = es.filter(e => e.constant).map(e => e.content).join('\n');
  const external = face + '\n' + constText;

  let keyTotal = 0, inOwn = 0, inExternal = 0, onlyOwn = 0, nowhere = 0;
  let perEntryKeys = [];
  for (const e of es) {
    if (e.constant) continue;
    const keys = (e.keys || []).filter(k => !e.useRegex);
    if (keys.length) perEntryKeys.push(keys.length);
    for (const k of keys) {
      keyTotal++;
      const own = String(e.content || '').includes(k);
      const ext = external.includes(k);
      if (own) inOwn++;
      if (ext) inExternal++;
      if (own && !ext) onlyOwn++;
      if (!own && !ext) nowhere++;
    }
  }
  const avg = perEntryKeys.length ? (perEntryKeys.reduce((a,b)=>a+b,0)/perEntryKeys.length).toFixed(2) : 0;
  console.log('\n■', name);
  console.log(`  条目数 ${es.length} | 非正则键 ${keyTotal} | 每条目平均键数 ${avg}`);
  console.log(`  键出现在【自己条目正文】里: ${inOwn}/${keyTotal} = ${(inOwn/keyTotal*100).toFixed(1)}%`);
  console.log(`  键出现在【卡面+常驻】外部源里: ${inExternal}/${keyTotal} = ${(inExternal/keyTotal*100).toFixed(1)}%`);
  console.log(`  只在自身正文、外部源没有(链式/死): ${onlyOwn} = ${(onlyOwn/keyTotal*100).toFixed(1)}%`);
  console.log(`  哪都没有(纯死词): ${nowhere} = ${(nowhere/keyTotal*100).toFixed(1)}%`);
  // 反模式7 判据：≥90% 键命中自身正文 且 外部源命中率低
  const flag = (inOwn/keyTotal) > 0.9 && (inExternal/keyTotal) < 0.5;
  console.log(`  ${flag ? '🚩 命中反模式7「照着内容生成」' : '✅ 未见反模式7'}`);
}
