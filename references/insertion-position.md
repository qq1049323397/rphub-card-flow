# 插入位置 position：酒馆惯例 + RP-Hub 的降级

> 这一页解决的问题：`position` 该选哪个、每个位置适合放什么。
> 结论来自两处：酒馆的官方语义（`position` 是酒馆字段），和四张酒馆卡的实际用法。
> RP-Hub 自己的卡在这件事上没有惯例可循，别拿它们当参考。

---

## 1. 先看字段是从哪来的

`position` 不是 RP-Hub 发明的。它是酒馆世界书的字段，RP-Hub 继承了它。
所以「每个位置适合放什么」这个问题，答案在酒馆那边，而且那边真的有答案。

酒馆源码 `public/scripts/world-info.js` 定义了 8 个位置：

| 值 | 酒馆标签 | 含义 |
|---|---|---|
| 0 | ↑Char | 角色定义**之前** |
| 1 | ↓Char | 角色定义**之后** |
| 2 | ↑AT | Author's Note 之前 |
| 3 | ↓AT | Author's Note 之后 |
| 4 | @D | 对话历史里指定**深度**处（配合 `depth` 与 `role`） |
| 5 | ↑EM | 示例对话之前 |
| 6 | ↓EM | 示例对话之后 |
| 7 | Outlet | 输出到指定 Outlet |

RP-Hub 只实现了其中一部分，另加了一个酒馆没有的：

| RP-Hub 值 | 对应酒馆 | 备注 |
|---|---|---|
| `before_char` | 0 ↑Char | |
| `after_char` | 1 ↓Char | |
| `global_note` | 2/3 ↑AT ↓AT | |
| `at_depth` | 4 @D | **但没有 `role` 字段** |
| `system_top` | 无 | RP-Hub 自有，系统提示最顶部 |
| `user_top` / `assistant_top` | 无 | RP-Hub 自有 |

---

## 2. 酒馆惯例：每个位置放什么

这是酒馆社区通行的一张对应表：

| 条目类型 | 位置 | 理由 |
|---|---|---|
| 世界观总纲、背景设定、社会规则 | ↑Char | 先给世界框架，再给角色 |
| 角色速览（多角色） | ↑Char | 宏观层：有哪几个角色 |
| 角色详细信息 | ↓Char | 补在角色定义之后 |
| NPC 详情 | ↓Char | 支撑角色定义，按键触发 |
| 场景 / 事件 / 物品 | ↓Char | 具体细节，按键触发 |
| 写作规范 / 指导 | ↑AT / ↓AT | 规则类，注入系统提示区 |
| **输出格式 / 变量更新规则 / 行为纠正** | **@D，depth=0** | **模型最后读到 → 影响力最强** |
| 示例对话的格式要求 | ↑EM / ↓EM | 包住示例对话 |

两条硬规矩：

- **不要用 depth ≥ 1。** 把内容插进对话消息之间会打断对话流，让模型困惑。
- **depth=0 只放行为指令，不放设定。** 它的用途是「当 X 发生时，做 Y」这种直接指令，
  不是世界观资料。

### 四张酒馆卡实测（对得上）

| 卡 | `before_char` | `after_char` | `at_depth` |
|---|---|---|---|
| 无职转生 | ×9，**56% 常驻** —— 世界观、战斗力基准、魔法体系、剑术体系 | ×475，**0% 常驻** —— 角色档案、国家势力 | ×5，**100% 常驻，depth=0** —— 变量更新规则、变量输出格式 |
| 春物 | ×72，**93% 常驻** —— 全局背景、时代背景、好感度系统、人员分布 | ×546，**3% 常驻** —— 角色档案 | ×5，**100% 常驻，depth 0-1** —— 变量输出格式 |
| 龙族 | ×325 —— 时间线总表 | — | ×153 —— 剧情推进 |
| 另一张 | ×189 | — | ×29，45% 常驻，**depth 全部为 0** |

规律很清楚：**`before_char` 是常驻的宏观框架，`after_char` 是触发的角色细节，
`at_depth` depth=0 是每轮必须贴住输出的格式与机制。**

---

## 3. RP-Hub 的两处降级

酒馆那张表照搬到 RP-Hub **不能直接用**。RP-Hub 的引擎有两处不同，都是变差。

### 3.1 `before_char` 与 `after_char` 是同一个东西

源码 `assets/js/app.js` L4412-4424：两边的条目被 `join('\n\n')` 拼成**一个字符串**。
L4467-4475：这个字符串作为**一条 `role:'user'` 消息**推入，排在全部对话历史之前。

实测：全部条目搬 `before_char` 与全部搬 `after_char`，组装出的消息**逐字节相同**。

⇒ 酒馆里「↑Char 给框架、↓Char 给细节」这个**先后**在 RP-Hub 里没有了。
两个位置随便选一个，另一个留着不用就行。

### 3.2 `at_depth` 没有 `role`

酒馆的 @D 可以选 `role=system`，于是 depth=0 的格式规则会变成一条**紧贴输出的系统消息**。
RP-Hub **没有这个字段**（源码里查不到 `role`）。

⇒ RP-Hub 的 `at_depth` 插入后，由 `postprocessContextMessages` 与相邻同角色消息
用 `\n\n` 合并。实测：`at_depth` 下玩家那句 18 字，变成 **5150 字**的一条 user 消息。

⇒ **在 RP-Hub 里，静态设定放 `at_depth` = 把你的世界观粘进玩家嘴里。**

### 3.3 还有一处：漏写 `position` 等于选了 `at_depth`

三处源码都这么填：`core-utils.js:702`、`data-services.js:633`、`app.js:8474`。

⇒ 生成的 JSON 里，「没写」和「故意选 at_depth」长得一模一样。
**每条都显式写 `position`**，否则你分不清是漏了还是选的。

---

## 4. 所以 RP-Hub 该怎么选

| 内容 | position | 依据 |
|---|---|---|
| 世界观总纲、背景设定、社会规则 | `before_char` | 酒馆 ↑Char |
| 角色档案、NPC 详情、场景 / 事件 / 物品 | `after_char` | 酒馆 ↓Char（机制上与上一行相同，分开只为读 JSON 时顺序清楚） |
| 写作规范、指导、铁律、契约、索引 | `system_top` | 酒馆用 ↑AT/↓AT；RP-Hub 没有 `role`，用 `system_top` 才能真的进系统层 |
| **输出格式、变量更新规则、每轮必须遵守的机制** | `system_top` | 酒馆用 @D depth=0；**RP-Hub 没有 `role`，照搬会粘进玩家消息**，所以改用 `system_top` |
| 剧情推进、当前阶段、当前状态块 | `at_depth` depth 1-4 | 需要在对话流里按深度出现 |

**最后一行是 `at_depth` 在 RP-Hub 里唯一站得住的用法。**
判定标准是「这条内容是不是只有走到那一步才成立」。
不随轮次变的设定放 `at_depth`，模型读到的内容与放前导层一样，只多付一笔被合并的代价。

### 换 position 治不了剧透

18 次调用对照（同一张未修复的卡，第 5 轮，只改 position，3 变体 × 2 探针 × 3 次）：

| 变体 | 终局词命中 | 未来集引用 | 输出可区分度 |
|---|---|---|---|
| 全 `at_depth` | 14 | 0 | — |
| 全 `before_char` | 11 | 0 | 与 at_depth 无法区分 |
| 全 `system_top` | 10 | 0 | 与 at_depth 无法区分 |

正文里写着结局，换哪个位置都会漏。**要防剧透，改的是条目正文，不是 position。**
见 `information-fog.md`。

---

## 5. 闸门能做什么

`scripts/gate.mjs` 检查 12 只**报观察**，最高 `warn`，永不 `fail`：

- position 分布
- 静态设定放 `at_depth` 的条数
- 缺 `position` 的条数
- 有没有条目放 `system_top`

它**不能**判断「这张卡有没有主线」，也不能判断位置选得对不对。
9 张外部卡量下来有 8 种分布，没有共识，闸门没有立场可站。

---

## 6. 复现方法

```bash
# 位置分布
node scripts/gate.mjs 某张卡.png

# 按位置切开看内容
node -e '
import("/path/to/scripts/rphub-card.mjs").then(({loadCard,entries})=>{
  const es = entries(loadCard(process.argv[1]).card);
  const by = {};
  for (const e of es) (by[e.position||"(缺失)"] ||= []).push(e);
  for (const [p,l] of Object.entries(by)) console.log(p, l.length);
});' 某张卡.png
```

---

## 7. 反模式

1. **静态设定放 `at_depth`。** 模型读到的内容与放前导层一样，但会被合并进玩家那条消息。
2. **不写 `position`。** 默认就是 `at_depth`，与故意选它无法区分。
3. **以为 `before_char` / `after_char` 是两个类别。** 机制上是同一个字符串。
4. **把酒馆的 @D depth=0 照搬过来放格式规则。** 酒馆那里是 system 消息，RP-Hub 不是。
5. **用 `at_depth` depth ≥ 1 放设定。** 插进对话消息之间会打断对话流。
6. **换 position 来防剧透。** 实测三个位置输出无法区分。
7. **拿 RP-Hub 的卡当 position 参考。** 那边基本没人管这个字段，分布散成 8 种。
