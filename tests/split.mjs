import { loadCard, entries } from '../scripts/rphub-card.mjs';
import path from 'node:path';

// 卡路径从命令行给，脚本内不写死任何卡 —— 这个包要能发给别人，
// 绝不能去摸一张只在本机存在（或早已被删）的卡。
const cards = process.argv.slice(2).map((p) => [path.basename(p), p]);
if (!cards.length) {
  console.error('用法: node tests/split.mjs <card.png|card.json> [...更多卡]');
  process.exit(2);
}
for (const [name, p] of cards) {
  let card, es; try { ({ card } = loadCard(p)); es = entries(card); } catch { continue; }
  const d = card.data || card;
  // ★ 扫描窗内（真正直接可触发）：只有开场白成为 chatHistory[0]，以及之后的对话
  const inScanWindow = [d.first_mes, ...(Array.isArray(d.alternate_greetings)?d.alternate_greetings:[])].filter(Boolean).join('\n');
  // prompt-only（AI 读得到 → 可能写出来 → 下一轮才进扫描窗）：间接
  const promptOnly = ['description','personality','scenario','system_prompt','post_history_instructions','mes_example'].map(k=>d[k]).filter(Boolean).join('\n');
  const constText = es.filter(e=>e.constant).map(e=>e.content+'\n'+e.comment).join('\n');
  const anyOtherEntry = es.map(e=>e.content+'\n'+e.comment).join('\n');

  const lit = es.filter(e=>!e.constant && (e.keys||[]).length && !e.useRegex);
  let direct=0, indirect=0, chained=0, dead=0;
  const deadList=[];
  for (const e of lit) {
    const ks = e.keys;
    if (ks.some(k=>inScanWindow.includes(k))) { direct++; continue; }
    if (ks.some(k=>promptOnly.includes(k)) || ks.some(k=>constText.includes(k))) { indirect++; continue; }
    if (ks.some(k=>anyOtherEntry.includes(k))) { chained++; continue; }
    dead++; deadList.push(e);
  }
  const tot = lit.length;
  const pct = n => (n/tot*100).toFixed(1).padStart(5)+'%';
  console.log('\n■', name, `— 非正则、非纯常驻条目 ${tot} 条`);
  console.log(`  A 直接窗内(开场白/对话)  ${String(direct).padStart(4)}  ${pct(direct)}   立即触发`);
  console.log(`  B 间接(prompt/常驻→AI写出)${String(indirect).padStart(4)}  ${pct(indirect)}   延迟一轮，靠AI服从`);
  console.log(`  C 链式(仅他条正文)        ${String(chained).padStart(4)}  ${pct(chained)}   上游先触发才可能`);
  console.log(`  D 死(哪都没有)            ${String(dead).padStart(4)}  ${pct(dead)}`);
  const oldDead = tot - direct - indirect;  // 旧口径把 B 也算活
  console.log(`  ── 旧口径死键率(把B算活): ${((tot-direct-indirect)/tot*100).toFixed(1)}%  新口径D: ${(dead/tot*100).toFixed(1)}%`);
  console.log(`  ── 若把 B 视作不可靠，则「无立即入口」条目率: ${((tot-direct)/tot*100).toFixed(1)}%`);
}
