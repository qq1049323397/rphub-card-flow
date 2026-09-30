import { applyOneRegex, renderSplit } from '../scripts/regex-doctor.mjs';
const GUARD = '^(?![\\s\\S]*(?:data-git-setup|git-story-shell|<!doctype\\s+html|<html\\b))([\\s\\S]+)$(?=>?)';
const REPL = '<div class="正文容器">$1</div>';
for (const [n, inp] of [['纯正文','这是普通正文。'],['正文+HTML','正文。\n<!DOCTYPE html>\n<html></html>'],['纯HTML','<!DOCTYPE html>\n<html></html>']]) {
  const out = applyOneRegex(inp, GUARD, REPL);
  const r = renderSplit(out);
  console.log(n.padEnd(10), '| 包裹:', out.includes('正文容器')?'是':'否', '| preText空白节点:', r.emptyPreTextNode);
  console.log('           ', out.slice(0,80).replace(/\n/g,'⏎'));
}
