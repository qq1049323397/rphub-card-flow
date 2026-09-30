#!/usr/bin/env node
/**
 * scan-utils.mjs — 扫描公共工具
 *
 * 抽出两个在审计中反复踩到的规则，供 key-audit / gate / regex-doctor 共用：
 *
 * 1. normalizeReplacement —— 替换文本里的 `$` 转义规则。
 *    通用字符串替换语义下 `$$` 表示一个字面 `$`，因此 `$$1` 是「字面 $ 后跟 1」，
 *    不是反向引用。扫描器若直接 `/\$1/` 判定，会把 `$$1` 误判成「保留了捕获」，
 *    进而漏报真正吞令牌的正则。实测某卡 567 个 `$$`、其中 1 处是 `$$1`。
 *
 *    注意：`$$` 出现在**被注入的 JS 源码**里时是二层转义（正则层还原一次，
 *    浏览器执行内层 replace 时再还原一次），同样不应算作本层的反向引用。
 *
 * 2. tokenDeclaredIn —— 令牌「声明」与「使用」的区别。
 *    消费方（正则 replacement、UI 模板）里出现的 `[TOKEN|变体]` 才是**声明**；
 *    世界书正文里出现的裸词只是**使用**（说明性引用、契约描述）。
 *    不区分就会出现「有消费方零产出方」的误报。
 */

/** `$$`→字面 `$` 的占位符。归一后用 \u0000 顶替，避免后续误判为反向引用。 */
const LITERAL_DOLLAR = '\u0000';

/**
 * 归一化替换文本，使反向引用判定符合同一层的语义。
 * 只处理 `$$` → 字面 `$`；其余 `$&` `$1` `$0` 等原样保留（它们确是引用）。
 */
export function normalizeReplacement(replacement) {
  return String(replacement ?? '').split('$$').join(LITERAL_DOLLAR);
}

/** 替换文本是否保留了匹配内容（反向引用 / {{match}}）。已正确处理 `$$`。 */
export function keepsCapture(replacement) {
  const norm = normalizeReplacement(replacement);
  return /\$1|\$&|\$0|\{\{match\}\}/.test(norm);
}

/**
 * 某令牌是否在「声明池」里被声明为具体变体。
 * 只认带分隔符的完整形式，如 `[ARRIVAL_IDENTITY|ordinary]`；
 * 正文里的裸词 `ARRIVAL_IDENTITY决定穿越身份` 不算声明。
 */
export function tokenDeclaredIn(token, text) {
  const tk = String(token || '');
  if (!tk) return false;
  const esc = tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 形如 [TOKEN|...] 或 [TOKEN] 的完整令牌
  return new RegExp(`\\[${esc}\\s*(?:\\||\\])`).test(String(text ?? ''));
}

/** 反向：某令牌是否只在「使用池」出现（说明性引用）。 */
export function tokenMentionedIn(token, text) {
  const tk = String(token || '');
  if (!tk) return false;
  return String(text ?? '').includes(tk);
}

export const __internal = { LITERAL_DOLLAR };
