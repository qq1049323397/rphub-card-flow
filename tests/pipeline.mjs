// 逐字复刻 RP-Hub 的处理链（core-utils.js splitProtectedText + app.js applyDisplayRegex）
const protectedContentPattern = /(<!DOCTYPE html>[\s\S]*?<\/html>|<html\b[^>]*>[\s\S]*?<\/html>|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!DOCTYPE html>[\s\S]*$|<html\b[^>]*>[\s\S]*$|<script\b[^>]*>[\s\S]*$|<style\b[^>]*>[\s\S]*$|<ui_template_updates\b[^>]*>[\s\S]*?(?:<\/ui_template_updates>|$)|<!--[\s\S]*?(?:-->|$)|```[\s\S]*?```|```[\s\S]*$|`[^`]+`|<\/?[a-zA-Z][\w:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>)/gi;

function splitProtectedText(text) {
  const source = String(text || '');
  const parts = []; let last = 0; let m;
  const re = new RegExp(protectedContentPattern.source, protectedContentPattern.flags);
  while ((m = re.exec(source)) !== null) {
    if (m.index > last) parts.push({ text: source.slice(last, m.index), protected: false });
    parts.push({ text: m[0], protected: true });
    last = m.index + m[0].length;
    if (!m[0]) re.lastIndex += 1;
  }
  if (last < source.length) parts.push({ text: source.slice(last), protected: false });
  return parts;
}
function transformUnprotectedText(text, transform) {
  return splitProtectedText(text).map(p => p.protected ? p.text : transform(p.text)).join('');
}

// app.js applyDisplayRegex 的核心（单条正则）
function applyOne(result, regexPattern, replacement, isImageGen = false) {
  let flags = 'g';
  if (regexPattern.startsWith('/') && regexPattern.lastIndexOf('/') > 0) {
    const last = regexPattern.lastIndexOf('/');
    const pf = regexPattern.substring(last + 1);
    if (/^[gimsuy]*$/.test(pf)) { flags = pf; regexPattern = regexPattern.substring(1, last); }
  }
  const re = new RegExp(regexPattern, flags);
  if (!/[<>]/.test(regexPattern) && !regexPattern.includes('```')) {
    const wholeMatch = re.exec(result); re.lastIndex = 0;
    const wrapped = wholeMatch?.[0] === result ? result.replace(re, replacement) : null;
    re.lastIndex = 0;
    return wrapped !== null && wrapped.includes(result)
      ? wrapped
      : transformUnprotectedText(result, part => part.replace(re, replacement));
  }
  return result.replace(re, replacement);
}

// runtime-services.js renderMarkdown 的 HTML 分支
function renderMarkdown(processed, { allowHtml = true } = {}) {
  if (!allowHtml) return '[sanitized-markdown]';
  const trimmed = processed.trim();
  const htmlMatch = trimmed.match(/(<!doctype html>|<html\b[^>]*>)/i);
  if (htmlMatch && !trimmed.includes('```')) {
    const startIndex = htmlMatch.index;
    const closeTag = '</html>';
    const closeIndex = trimmed.toLowerCase().lastIndexOf(closeTag);
    const hasCloseTag = closeIndex !== -1 && closeIndex > startIndex;
    const endIndex = hasCloseTag ? closeIndex + closeTag.length : trimmed.length;
    const preText = trimmed.substring(0, startIndex);
    return { mode: 'iframe', preText, iframeHtml: trimmed.substring(startIndex, endIndex), rawPreTextEmpty: preText.trim() === '' };
  }
  return { mode: 'markdown', text: processed };
}

// ── 测试 ──
const OLD_RE = '^([\\s\\S]*?)(?=<!DOCTYPE|$)';
const NEW_RE = '^(?!\\s*<!DOCTYPE)([\\s\\S]+?)(?=<!DOCTYPE|$)';
const REPL = '<div class="正文容器">$1</div>';

const cases = {
  'A 纯正文': '这是普通正文。\n\n第二段正文。',
  'B 纯HTML(行首)': '<!DOCTYPE html>\n<html>\n<body>测试 UI</body>\n</html>',
  'C 正文+HTML': '这里是一段普通正文。\n\n<!DOCTYPE html>\n<html>\n<body>UI</body>\n</html>',
  'D DOCTYPE前有换行': '\n\n<!DOCTYPE html>\n<html>\n<body>UI</body>\n</html>',
  'E DOCTYPE前只有空格': '     \n<!DOCTYPE html>\n<html>\n<body>UI</body>\n</html>',
  'F 无DOCTYPE但有html': '<html>\n<body>UI</body>\n</html>',
};

for (const [name, input] of Object.entries(cases)) {
  console.log('='.repeat(78));
  console.log('■', name);
  for (const [label, re] of [['旧正则', OLD_RE], ['新正则', NEW_RE]]) {
    const out = applyOne(input, re, REPL);
    const r = renderMarkdown(out);
    const head = out.slice(0, 90).replace(/\n/g, '⏎');
    const emptyDiv = /<div class="正文容器">\s*<\/div>/.test(out);
    console.log(`  ${label}: ${head}${out.length > 90 ? '…' : ''}`);
    console.log(`     渲染模式=${r.mode}${r.mode === 'iframe' ? ` | preText=${JSON.stringify(r.preText)} | preText为空=${r.rawPreTextEmpty}` : ''}` + (emptyDiv ? '  ← 产生空容器!' : ''));
  }
}
