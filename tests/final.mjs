const FINAL = '^(?!\\s*(?:<!DOCTYPE|<\\?xml|<html))(?=\\S)([\\s\\S]*?)(?=(?:<!DOCTYPE|<\\?xml|<html)|$)';
const OLD   = '^([\\s\\S]*?)(?=<!DOCTYPE|$)';
const REPL  = '<div class="正文容器">$1</div>';
const cases = {
  'A 纯正文': '这是普通正文。', 'B 纯HTML': '<!DOCTYPE html>\n<html><body>x</body></html>',
  'C 正文+HTML': '正文。\n<!DOCTYPE html>\n<html><body>x</body></html>',
  'D 前换行': '\n\n<!DOCTYPE html>\n<html></html>', 'E 前空格': '  \n<!DOCTYPE html>\n<html></html>',
  'F 无DOCTYPE': '<html><body>x</body></html>',
  'G 正文+无DOCTYPE': '正文。\n<html><body>x</body></html>',
  'H 纯空白': '   \n  ',
  'I XML声明': '<?xml version="1.0"?>\n<html></html>',
};
console.log('最终候选:', FINAL); console.log();
let pass = 0, total = 0;
for (const [n, inp] of Object.entries(cases)) {
  const out = new RegExp(FINAL, 'g').test(inp) ? inp.replace(new RegExp(FINAL, 'g'), REPL) : inp;
  const oldOut = inp.replace(new RegExp(OLD, 'g'), REPL);
  const empty = /正文容器">\s*<\/div>/.test(out);
  const wantContainer = ['A', 'C', 'G'].includes(n[0]);
  const hasC = out.includes('正文容器');
  const ok = !empty && hasC === wantContainer && (wantContainer ? /正文容器">\S/.test(out) : true);
  total++; if (ok) pass++;
  console.log((ok ? '✅' : '❌'), n.padEnd(16), '容器', hasC ? '有' : '无', '| 旧正则空容器:', /正文容器">\s*<\/div>/.test(oldOut) ? '是' : '否');
  console.log('    新:', out.slice(0, 78).replace(/\n/g, '⏎'));
}
console.log(`\n结果: ${pass}/${total} 通过`);
