# 关键词可达性：卡面 ≠ 扫描窗（本插件最重要的一条校正）

> 2026-09-23 审计。裁决了用户上传的《世界书关键词审查修理》skill 与《RP-Hub 正则 UI 检修报告》，
> 并**推翻了本插件自己早先的错误**。以下是源码事实，不是推测。

## 一、裁决结果总表

| 来源的说法 | 源码裁决 | 处理 |
|---|---|---|
| zip：PNG 读取优先级 `chara`→`ccv3`→嗅探，`RoleplayHubCard` 已弃用 | ✅ **对**。`core-utils.js` L446-453 证实；`RoleplayHubCard` 在源码中零出现 | **已修** `rphub-card.mjs`：早先写成 RoleplayHubCard 优先，对同时带两块的卡会读错 |
| zip：卡面（description/personality/scenario）是 **A 级可靠**触发源 | ❌ **错**（且我原先的 gate.mjs 也这么错） | **已修**：卡面是 prompt 层，不进扫描窗 |
| zip 内部自相矛盾：`scanDepth=null`=「全楼扫描」 vs 「=全局默认 2」 | 后半句对。`data-services.js` L603 `entry.scanDepth ?? settings.scanDepth`，全局默认 2（app.js L1309） | 采信「默认 2」；前半句删除 |
| zip：`triggerSlash` 把字面**真送进**对话流 | ⚠️ **半对**。`app.js` L7723-7735 只把文本存进 `pendingCardInteraction` 并聚焦输入框；**不会自动发送**，需玩家按发送 | 降级为「预填通道」，不是直达通道 |
| zip：`selective`/`secondary_keys` 是配置噪音 | ✅ 对，且更强：RP-Hub **完全不读**这两个字段（grep 零命中） | 归入白写字段 |
| zip：`markdownOnly` 正则改写的须验 `replaceString` 保留 `$1` | ⚠️ **前提错，结论不成立**（2026-09-30 更正）。卡内正则**从不写回 `chatHistory`**：`applyDisplayRegex`→`processRegex({isDisplay:true})` 的返回值只喂给渲染；扫描窗读存储原文（`app.js` L4359，函数体内 `processRegex` 出现 0 次）。ArC `ARCADIA主线阶段隐藏` 正是 `markdownOnly:true`+`replaceString:"$1"`，**隐藏了显示、但下一轮照常触发** | **已更正**：改写为「阶段名避开宿主文风过滤词」（见 `mainline-trigger.md` §六附）。`gate.mjs` 的 `正则吞令牌` 一项**脚本未改**（本轮只改文档），仍按旧口径输出 `warn` —— 看到它时以本节结论为准 |
| 报告：零长匹配 `[\s\S]*?` 在 HTML 开场前插入空容器 | ✅ **对**，已用真实源码链复现 | 见 `regex-ui-audit.md` |
| 报告提议的修正 `^(?!\s*<!DOCTYPE)([\s\S]+?)(?=<!DOCTYPE\|$)` | ⚠️ **不完整**。漏了「无 DOCTYPE 的 `<html>`」和 `<?xml` 声明开头 | 换成下面的最终版 |

## 二、核心事实：触发只在扫描窗，卡面进不去

```js
// data-services.js L581-616（逐字）
const scanText = chatMessages.slice(-scanDepth).map(m => m?.content || '').join('\n');
```

`chatMessages` 的来源（`app.js` L4359-4361）：

```js
const postprocessedChatHistory = getPostprocessedChatMessages(
    chatHistory.value.map(...), { includeSystem: false });
resolveWorldInfoEntries(worldInfo.value, postprocessedChatHistory, worldInfoSettings);
```

- `includeSystem:false` → 只有 `user` / `assistant` 聊天消息。
- 常驻条目（`constant:true`）在 L598-601 **直接**进 `triggerMap`，不看键、不看扫描窗。
- 已注入的世界书内容**不回流**进 chatHistory → **不存在递归**。

### 结论：键按「离扫描窗多远」分五档

| 档 | 键出现在哪 | 触发时机 | 可靠性 |
|---|---|---|---|
| **A 直接** | `first_mes`（= chatHistory[0]，role=assistant）/ 已发生的对话 | 立即 | 唯一"立刻生效" |
| **B 间接** | `description`/`personality`/`scenario`/`system_prompt`/`post_history_instructions`/`mes_example` | AI 读得到 → 写出该词 → **下一轮**才进窗 | 取决于 AI 服从性 |
| **S 常驻索引** | 被某条 `constant` 条目正文点名 | 常驻每轮进 prompt，AI 说得出即可 | 中（比 B 多一层兜底） |
| **C 链式** | 只在其他条目正文里 | 上游先触发 + AI 复述，才可能 | 低 |
| **D 死** | 全卡零出现 | 永不 | — |

**关键推论**：`description` 里写了十个地名，不会让任何一条地名条目更容易触发 —— 除非 AI 主动把地名写进正文。
`first_mes` 是唯一例外，因为它真的被当成一条 assistant 消息放进 chatHistory（`app.js` L6761-6766）。

## 三、正则 UI：最终推荐写法

原（危险，`*?` 允许零长匹配）：

```regex
^([\s\S]*?)(?=<!DOCTYPE|$)
```

**推荐（本插件实测 9/9 边界通过）**：

```regex
^(?!\s*(?:<!DOCTYPE|<\?xml|<html))(?=\S)([\s\S]*?)(?=(?:<!DOCTYPE|<\?xml|<html)|$)
```

replacement 不变：`<div class="正文容器">$1</div>`

三处修正的意义：
1. `(?=\S)` 要求紧跟一个非空白字符 —— 纯空白消息不再生成空容器。
2. 守卫扩到 `<?xml` 和 `<html>` —— 报告只防了 `<!DOCTYPE`，**无 DOCTYPE 的 HTML 开场仍会被包成空容器**。
3. 终止条件同步扩到 `<\?xml|<html` —— 否则「正文 + 无 DOCTYPE 的 HTML」会把整个 HTML 吞进 div 里。

### 实测对照（真实源码链复刻）

| 输入 | 旧正则 | 报告提议 | 本插件推荐 |
|---|---|---|---|
| 纯正文 | 正常包裹 | 正常包裹 | 正常包裹 |
| 纯 HTML（行首） | ❌ 空容器 | 正常 | 正常 |
| HTML 前有换行 | ❌ 空容器 | 正常 | 正常 |
| HTML 前有空格 | ❌ 空容器 | 正常 | 正常 |
| 无 DOCTYPE 的 `<html>` | ❌ 空容器 | ❌ 空容器 | 正常 |
| `<?xml` 声明开头 | ❌ 空容器 | ❌ 空容器 | 正常 |
| 正文 + 无 DOCTYPE 的 HTML | ⚠️ 吞掉 HTML | ⚠️ 吞掉 HTML | 正常分出 |

### 关于「守卫写成全串匹配」——不是缺陷

RP-Hub 卡里最常见的守卫是：

```regex
^(?![\s\S]*(?:data-git-setup|git-story-shell|<!doctype\s+html|<html\b))([\s\S]+)$(?=>?)
```

`[\s\S]*` 是**全串**匹配，所以只要消息里任何位置有 HTML，整条就不包裹。
副作用：「正文 + HTML」的消息里正文失去容器样式。
但这是**作者有意的幂等设计**（避免重复套壳），且全库 286 条外壳正则写法高度一致，属共享模板。
→ 只作观察项报告，**不判缺陷**。改不改取决于卡的玩法。

## 四、实测数字

| 卡 | 条目 | A 直接 | B 间接 | S 常驻索引 | C 链式 | D 待定点 | 无立即入口 |
|---|---|---|---|---|---|---|---|
| 范本A·百万字大世界（2026-09-30） | 2282 | 3 (0.1%) | 57 (2.5%) | 1800 (80.0%) | 291 (12.9%) | 100 (4.4%) | 99.9% |
| 范本B·恋爱向（2026-09-23，卡已不在） | 81 | 0 (0%) | 21 (31.3%) | 46 (68.7%) | 0 | 0 | **100%** |
| 范本C·恐怖大世界（2026-09-23） | 758 | 67 (9.1%) | 26 (3.5%) | 132 (18%) | 509 (69.3%) | 10 (1.4%) | 90.9% |

- 范本A：S 档（常驻索引救活）80.0%，是这几张卡里触发面最稳的。D 档 100 条中
  **6 条字面死键 + 94 条正则待定点**（见第七节，旧表把两者混算成「死」）。
  注：gate.mjs 另有一条同名但口径不同的「常驻索引覆盖 88.9%」（分母只算字面 key 条目），
  与本表的 S 档占比不可互相换算。
- 范本B：**零延迟入口**，全靠 AI 配合 + 1 条常驻索引兜住 68.7%。健壮性建立在 AI 服从上。
  （该卡文件已从库中删除，数字保留作历史基准。）
- 范本C：69.3% 是链式（依赖上游带动），但常驻索引覆盖仅 16.6% → 触发面脆弱。
- ⚠️ 2026-09-23 两行的「D 死」列是 **D 档拆分前**的旧口径，与范本A 行的「D 待定点」不可直接比较。
- 全库 307 张带正则的卡共 1765 条正则，**产生空容器的 0 条**；正文外壳 286 条全部已有 HTML 守卫。

## 五、RP-Hub 白写字段（写进去也不读）

`selective`、`secondary_keys`、`caseSensitive`、`matchWholeWords`、`excludeRecursion`、
`preventRecursion`、`delayUntilRecursion`（含 snake_case 变体）。

`triggerSlash` 通道：卡内 HTML 用 `data-slash="文本"` 属性（`data-services.js` L1273-1279），
点击后 `window.triggerSlash` → `pendingCardInteraction` → **需玩家发送**。

## 六、自检命令

```bash
cd <本 skill 目录>/scripts
node key-audit.mjs <卡>                  # 五档可达性
node key-audit.mjs <卡> --tier=D          # 死键清单（已排除正则待定点）
node regex-doctor.mjs <卡>                # 正则 UI 九项边界
node regex-doctor.mjs --scan-dir=<你的 RP-Hub 目录>   # 全库批量
```

## 七、两个曾把工具作者骗过去的坑（2026-09-30 修正）

### 1. D 档必须拆成「字面死键」与「正则待定点」

D 档的定义是「静态文本零命中」，但它混了两种性质完全不同的条目：

- **字面死键**：`use_regex=false`，键是普通字符串，全卡零出现 → 真的永不触发。
- **正则待定点**：`use_regex=true`，键是正则，等的是**运行时才生成**的正文。
  静态扫不到是正常的，不是缺陷。

范本A 实测：D 档 100 条里 **94 条是正则键、只有 6 条是字面键**。
先前把 100 条一起报成「死键」，是工具造成的假阳性 —— 那 94 条（如
`\[SCENE\|(?:[^|\]\r\n]*\|){3,4}Zone\s*0\s*/`）等的正是正文里 AI 每轮生成的场景块。

`key-audit.mjs` 现在分开报，且 **exit code 只看字面死键**。

### 2. 替换文本里的 `$$` 不是反向引用

通用字符串替换语义下 `$$` 表示一个字面 `$`。所以 `$$1` 是「字面 $ 后跟 1」，
**不是**反向引用。扫描器若直接 `/\$1/` 判断「保留了捕获」，会把 `$$1` 误判成
保留，从而**漏报真正吞令牌的正则**。

更隐蔽的一层：`$$` 出现在**被注入的 JS 源码**里时是二层转义（正则层还原一次，
浏览器执行内层 replace 时再还原一次）。范本A 那个 `$$1` 就在
`ARCADIA开场启动界面` 的 replacement 内嵌 JS 里，属于正确写法。

实卡实测：567 个 `$$`（全部合规）、1 处 `$$1`。
判定逻辑集中在 `scripts/scan-utils.mjs` 的 `normalizeReplacement()` / `keepsCapture()`。

### 3. 警告级发现不是缺陷

`regex-doctor.mjs` 的 `warnings`（正文未包裹）是**行为观察**，不是缺陷。
先前 `findings` 里既装 fails 又装 warnings，导致「打印 ❌ 但 `--json` 里
`fails: []`」且 exit=1 的假失败。现在 `auditWrapper` 返回 `hasFatal`，
CLI 用 `❌` 报失败、`ℹ️` 报观察，exit code 只看 `hasFatal`。
