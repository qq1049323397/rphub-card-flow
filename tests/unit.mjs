import { auditWrapper } from '../scripts/regex-doctor.mjs';
const REPL = '<div class="正文容器">$1</div>';
const cases = [
  ['报告里的旧正则(危险)', '^([\\s\\S]*?)(?=<!DOCTYPE|$)', true],
  ['报告提议的修正', '^(?!\\s*<!DOCTYPE)([\\s\\S]+?)(?=<!DOCTYPE|$)', 'partial'],
  ['我的最终修正', '^(?!\\s*(?:<!DOCTYPE|<\\?xml|<html))(?=\\S)([\\s\\S]*?)(?=(?:<!DOCTYPE|<\\?xml|<html)|$)', false],
  ['某卡现有守卫', '^(?![\\s\\S]*(?:data-git-setup|git-story-shell|<!doctype\\s+html|<html\\b))([\\s\\S]+)$(?=>?)', false],
];
for (const [name, re, expectBad] of cases) {
  const a = auditWrapper(re, REPL);
  const bad = a.fails.length > 0;
  const verdict = expectBad === true ? (bad ? '✅正确抓到' : '❌漏检') : expectBad === false ? (bad ? '❌误报' : '✅正确放行') : (bad ? `⚠报${a.fails.length}项` : '✅放行');
  console.log(`${verdict.padEnd(12)} ${name}`);
  for (const f of a.fails) console.log(`               · [${f.case}] ${f.reason}`);
}
