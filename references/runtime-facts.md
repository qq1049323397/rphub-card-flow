# RP-Hub 运行时事实（写卡前必须知道）

**事实源**：RP-Hub 网站源码 @ `c52ac9a`（2026-09-17，随包不含）
**读取方式**：只读。**绝不修改该仓库** —— 改了就等于改了用户的网站。
所有结论都标了源码行号，可自行回查。

---

## 1. 世界书条目：运行时真正读哪些字段

### 读取（归一化）
`assets/js/core-utils.js` → `normalizeWorldInfoEntry()`（L556-624）

| 运行时字段 | 兼容写法 | 默认值 | 说明 |
|---|---|---|---|
| `comment` | — | `''` | 名称/备注，UI 索引显示用 |
| `content` | — | `''` | 正文 |
| `enabled` | `disable` / `disabled` | `true` | `disable=true` 会翻转 |
| `keys` | `key`（字符串按 `,` `，` 切分） | `[]` | 触发词 |
| `useRegex` | `use_regex` | `false` | 关键词是否按正则匹配 |
| `constant` | — | `false` | 常驻，无需关键词 |
| `position` | 见下方别名表 | `at_depth` | 注入位置 |
| `order` | `insertion_order` | `0` | 越大越靠前 |
| `depth` | — | `4` | `at_depth` 时的插入深度 |
| `scanDepth` | `scan_depth` | `null` | 自定义扫描层数 |
| `probability` | — | `100` | 触发概率 |
| `useProbability` | `use_probability` | `true` | |
| `scope` | — | `character` | `global` 走全局世界书 |

### 写入（导出）
`assets/js/core-utils.js` → `toWorldInfoExportEntry()`（L694-708）
导出时**只写**：`comment` `content` `enabled` `scope` `keys` `useRegex` `constant` `position` `order` `depth` `scanDepth` `probability` `useProbability`

### extensions 提升
`normalizeWorldInfoEntry` L558-561：`entry.extensions` 里的键会被**提升到顶层**。
所以 `extensions.depth` 是有效的（会被提升成 `depth`），但 `extensions.useRegex` 同样有效。
**不在上表里的键，无论写在顶层还是 extensions 里，一律无效。**

### 常见白写字段（实测三张范本都踩了）
`caseSensitive` / `matchWholeWords` / `excludeRecursion` / `preventRecursion` / `delayUntilRecursion`
以及它们的 snake_case 版本 `case_sensitive` / `match_whole_words` / `exclude_recursion` / `prevent_recursion` / `delay_until_recursion`
—— 这些是酒馆字段，RP-Hub **不读**。写了等于没写。

> ⚠️ 特别注意：`preventRecursion` 之类让人以为"能控制递归"，但 **RP-Hub 根本没有递归**（见第 3 节），这些字段既无效也没必要。

---

## 2. position 位置与别名

`normalizeWorldInfoEntry` L582-605

合法值：
`system_top` `global_note` `before_char` `after_char` `at_depth` `user_top` `assistant_top`

别名映射：

| 别名 | 归一为 |
|---|---|
| `before_character` `character_top` `before_examples` `example_top` | `before_char` |
| `after_character` `character_bottom` `after_examples` `example_bottom` | `after_char` |
| `an_top` `author_note` `an_bottom` | `global_note` |

数字写法：`0`→`before_char`，`1`→`after_char`，`2`/`3`→`global_note`，`4`→`at_depth`

### 注入顺序（实测）
`assets/js/app.js` L4404-4434

```
1. 破限预设
2. wiGroups.system_top        ← 常驻规则放这里
3. wiGroups.global_note
4. 其他预设
5. wiGroups.before_char       ← 人物/地点/能力条目放这里
6. [Character] + mes_example
7. wiGroups.after_char
8. 用户信息
... at_depth 按 depth 插入到对话历史中
```

排序规则（`data-services.js` L618-636）：**常数条目优先，然后 `order` 降序**；同一组内再按 `order` 升序排。

---

## 3. 触发机制：没有递归

`assets/js/data-services.js` → `resolveWorldInfoEntries()`（L581-639）

```js
const postprocessedChatHistory = getPostprocessedChatMessages(
  chatHistory.value.map(...), { includeSystem: false });   // app.js L4359-4361
const { entries, groups, triggerMap } = resolveWorldInfoEntries(
  worldInfo.value, postprocessedChatHistory, worldInfoSettings);
```

关键事实：

1. **扫描对象**：最近的 `scanDepth` 层消息
   - `scanDepth` 取条目的 `scanDepth`，为 `null` 时用全局设置
   - 全局默认 `scanDepth: 2`（`app.js` L1309）
   - `maxDepth` 默认 `0` = 不封顶（`data-services.js` L604-605）
2. **只含 user + assistant**：`includeSystem: false`，`getPostprocessedChatMessages` 的 `mergeRoles: ['user','assistant']`（`data-services.js` L487-494）
3. **已注入的世界书正文不回流** —— 因为 system 消息被排除，且注入内容挂在 `_worldInfoEntries` 元数据上
4. **不存在递归**：条目 A 的正文里提到条目 B 的关键词，**不会**让 B 触发
5. **卡面不是扫描窗** —— `description`/`personality`/`scenario`/`system_prompt`/`post_history_instructions`/`mes_example`
   都是 prompt 层，**永远不进扫描窗**，写在那里的 key 不会直接触发。
   只有 `first_mes` 例外：它成为 `chatHistory[0]`（role=assistant），真的在窗内。
   → 完整分档与实测数字见 `key-reachability.md`

### 实测 scanDepth 分布（三张范本）

| 卡 | scanDepth 取值分布 | 最大值 |
|---|---|---|
| 范本A | 4×1774, 8×53, 2×36, 10×23, 6×10, 5×5 | 10 |
| 范本D | 4×1576, 6×826, 2×1304, 0×93, 1×1 | 6 |
| 范本E | 4×358, 8×95, 5×66, 6×47, 3×24, 2×16 | 8 |

**结论：触发窗口只有最近 2~10 层。** 一个名字如果 AI 在这 10 层里没说出来，就永远触发不了。

### key 匹配语义
`data-services.js` L568-579 `worldInfoKeyMatchesText()`
- `useRegex=false`：**大小写不敏感的子串匹配**（`toLowerCase().includes()`），不是分词，不是模糊
- `useRegex=true`：`createRegex()`（L553-566），支持 `/pattern/flags` 写法，强制去 `g`、强制加 `i`

---

## 4. 索引法：无递归的唯一解药

既然没有递归、窗口只有 2~10 层，让条目触发只有两条路：

1. key 是玩家/AI 一定会说的泛称
2. **把名字预先摆在 AI 眼前** —— 写常驻条目（`constant=true`、无 key），正文里成组列出人物全名、地点名、事件名

AI 读了常驻索引，才会在正文里叫出这些名字，条目才被触发。这就是范本A 的做法。

### 实测效果

| 卡 | 字面 key 条目 | 死键率 | 常驻索引覆盖 |
|---|---|---|---|
| 范本A | 1763 | **3.6%** | **93.4%** |
| 范本D·武侠大世界 | 2506 | 61.0% | 19.6% |
| 范本E·系统流 | 576 | 91.3% | 3.0% |

范本A 的「索引·作品与人物总目录」（`constant=true`、`position=system_top`、1854 字）一条就覆盖了 1655 个条目。

### 索引条目的形态
- `constant: true`（必须）
- `keys: []`（常驻不需要 key）
- `position: system_top`（放最前，最稳）
- 正文：分组列出名字，并写一句"人物进入镜头后以其正式全名召回详细档案"之类的路由说明

---

## 5. 卡文件结构

### 容器
PNG 的 `tEXt` 块，读取优先级**以源码为准**（`core-utils.js` L446-453 `findPngCharacterPayload`）：

1. `chara` —— base64 编码的 JSON（**优先读这个**）
2. `ccv3` —— 同上格式
3. JSON 嗅探 —— 找第一个 `trim()` 后长度 >50 且以 `{` 或 `ey` 开头的块

> ⚠ 2026-09-23 校正：早先本文件写「`RoleplayHubCard` 优先」，**是错的**。
> `RoleplayHubCard` 在 RP-Hub 源码里**零出现**（已弃用）。若一张卡同时带
> `RoleplayHubCard`（旧导出，未归一化）和 `chara`（运行时真正解析的那份），
> 按旧优先级会读到错的数据。`rphub-card.mjs` 已改为跟随源码顺序。

导出时两者都写。还有 `rp_hub_credit`（署名）和 `rp_hub_fingerprint`（指纹）。

### 数据路径
```
data.character_book.entries[]     ← 世界书
data.uiTemplates                  ← UI 模板
extensions.regex_scripts          ← 正则（部分卡放在这个位置）
extensions.rp_hub_ui_templates    ← UI 模板（兼容位置）
data.description / personality / scenario / first_mes / alternate_greetings
```

读取入口：`core-utils.js` → `parseImportedCharacterCard()`（L657-690）

正则与 UI 模板的兼容位置（L661-674）：
```
regex:  character.extensions.regex_scripts || source.extensions.regex_scripts || ...
ui:     character.uiTemplates || character.ui_templates || source.uiTemplates
        || character.extensions.ui_templates || character.extensions.rp_hub_ui_templates || ...
```

---

## 6. 正则 UI 与变量 UI 的风险

（用户痛点，源码依据）

- **正则 UI 依赖 AI 输出格式**：正则匹配的是 AI 生成的文本。格式一偏，正则不命中，UI 就失效 —— 没有任何兜底。
- **正则执行时有保护**：`app.js` L3247 附近，普通正则会保护 HTML/代码，明确匹配标签或代码围栏的规则才直接执行。
- **显示模式与发送模式分流**：`app.js` L3213-3214
  ```js
  if (isDisplay && script.promptOnly) return;   // 显示模式跳过仅 AI 可见的正则
  if (isPrompt && userOnly) return;             // 发送前跳过仅用户可见的正则
  ```
  两项都没勾也按"仅用户可见"处理。

**制卡建议**：UI 是锦上添花。优先把世界书和正文写扎实；UI 用变量驱动而非正则匹配输出格式，能减少"格式一错就失效"。

### 6.1 自己写的着色正则，会打断别人的结构化标签（实测）

**这是一条真踩过的坑，不是推理。**

**现象**：开了宿主的「NAI画图正则」后，模型输出的 `image###…###` 里**只要出现中文专名**，
生图卡的 `data-image-request` 里 `tag=` 就**只截到中文词之前**，剩下的内容和收尾的 `###`
漏在正文里。实测：

| 提示词 | URL 里实际拿到的 tag |
|---|---|
| `1girl, shiina shio, black hair, school uniform, library, school gate` | 全文完整 ✅ |
| `1girl, shio, black hair, at 图书室` | `1girl, shio, black hair, at ` ❌ |
| `1girl, 椎名汐, black hair` | `1girl, ` ❌ |
| `1girl, solo, 4k, (depth of field:1.2)` | 全文完整 ✅ |

纯英文 + 数字 + 括号权重都不受影响；**只有中文专名会炸**。

**根因（三步，可用源码复核）**：

1. **着色正则先跑**：普通中文词替换把 `图书室` 变成
   `<span style="color:…">图书室</span>`。
2. **NAI 正则被强制排最后**：`app.js` L3195-3199 把名为「NAI画图正则」的脚本
   **强制排到末位**。所以它跑的时候，`image###…###` 中间**已经混进了 HTML 标签**。
3. **保护段机制把它切开**：NAI 的模式串里**没有 `<`/`>`**，于是走
   `transformUnprotectedText` 分支（`app.js` L3248-3256）。这个分支先按
   `protectedContentPattern`（`core-utils.js` L278）切分，**只对普通段做替换**。
   而那条分段正则的末支是
   `<\/?[a-zA-Z][\w:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>`
   —— **任何 HTML 标签都会成为受保护段**。

实测切分结果（用源码里那条正则原样跑）：

```text
"image###1girl, shio, at "                受保护=false  ← 只有这段被替换
"<span style=\"color:…\">"                受保护=true
"图书室"                                   受保护=false
"</span>"                                 受保护=true
"###"                                     受保护=false
→ 替换结果：CARD[tag=1girl, shio, at ]<span …>图书室</span>###
```

**规矩**：

- **凡是要插 HTML 标签的着色/美化正则，都可能打断同一段文本里的结构化标签**
  （生图 `image###…###`、状态块、变量块、`<ui_template_updates>` 同理）。
  写之前先问：这条正则的匹配范围，会不会落进别人的结构化标签内部？
- **优先在世界书里约束模型的输出格式**，而不是靠正则去修 AI 的文本。
  生图 Tag 一律英文（宿主自带提示词也是这么要求的），从源头避开。
- **卡里改不了执行顺序**：顺序由宿主决定，别指望"让我的正则排后面"。

**自查**：`image###` 那类标签里的内容，会不会命中你任何一条着色正则的词表？
命中就要处理。

### 6.2 面板正则的 `[\s\S]*$` 会吃掉它后面的一切（实测）

带状态块的面板正则（`findRegex` 结尾是 `[\s\S]*$`）**从状态块一路吃到全文末尾**。
所以状态块之后的内容会被整段吞进面板替换里：

| 位置 | 结果 |
|---|---|
| 生图卡放状态块**之前** | ✅ 保住 |
| 生图卡放状态块**之后** | ❌ 整张消失 |

**规矩**：**状态块必须是回复里最后一个块。** 任何需要在气泡里显示的东西
（生图卡、额外面板、章节标）都排到它前面去。

> 宿主自带的自动生图提示词也明令禁止"让图片成为整次回复的结尾"，
> 两者是一致的，不冲突。

---

## 7. 怎么自己复核这些结论

```bash
# 拉源码（只读）
git clone --depth 1 https://github.com/STA1N156/RP-Hub.git /tmp/rphub-src

# 看归一化（决定能写什么字段）
sed -n '556,624p' /tmp/rphub-src/assets/js/core-utils.js

# 看触发解析（决定怎么才会触发）
sed -n '581,639p' /tmp/rphub-src/assets/js/data-services.js

# 看注入顺序（决定 position 怎么用）
sed -n '4400,4440p' /tmp/rphub-src/assets/js/app.js
```

本 skill 的脚本（`scripts/rphub-card.mjs`）就是按这些行号复刻的；若上游更新，先改那一份。
