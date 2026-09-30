# rphub-card-flow

> 给 RP-Hub 角色卡用的**分阶段制卡流程**：先把一张卡自己的世界书骨架读出来（order 分段 / 每段类别 / 条目小节 / 字数分布），再一段一段写、一段一段过闸门。

一套可在本地直接跑的脚本 + 一套平台无关的设计原则。**不依赖任何具体卡**、不需要 `npm install`、只用 Node 内置模块。

```
node tests/run-tests.mjs        # 24 通过 / 0 失败，exit 0
```

---

## 它解决什么问题

做一张大卡时最容易踩的三个坑，这套流程各有一个工具盯着：

| 坑 | 症状 | 对应工具 |
|---|---|---|
| **世界书写了但不触发** | 关键词在哪都没出现，条目永远是死的 | `key-audit.mjs` 五档可达性 |
| **正则 UI 多出空容器** | 聊天顶部冒出一个空框、额外气泡 | `regex-doctor.mjs` 九项边界体检 |
| **交付时才发规模失控** | 卡面几千字、常驻条目吃掉全部预算 | `gate.mjs` 交付闸门 |

背景：RP-Hub 的世界书**没有递归触发**，且**卡面不进扫描窗**。这两条运行时事实决定了关键词策略和 ST 很不一样——见 `references/runtime-facts.md`。

## 快速开始

```bash
git clone <本仓库>
cd rphub-card-flow
node tests/run-tests.mjs          # 先确认环境正常

# 需要卡的操作，自己给路径（脚本内不写死任何卡）
node scripts/skeleton.mjs     <卡.png>
node scripts/gate.mjs         <卡.png>     # exit 1 = 未过闸门
node scripts/key-audit.mjs    <卡.png>     # exit 1 = 有字面死键
node scripts/regex-doctor.mjs <卡.png>
node scripts/regex-doctor.mjs --scan-dir=<卡目录>   # 全库批量
```

支持 `.png`（chara / ccv3 / 嗅探三种解包路径）与 `.json`。

## 五档关键词可达性

这是本仓库最核心的东西。RP-Hub 没有递归，所以一条条目能不能触发，取决于它的 key 出现在哪：

| 档 | 含义 | 触发延迟 |
|---|---|---|
| **A** | key 在开场白/对话里（真正在扫描窗内） | 立即 |
| **B** | key 在卡面 prompt 字段（AI 读得到、可能写出来） | 延迟一轮，靠 AI 服从 |
| **S** | 被常驻索引条目点名 | 靠索引覆盖 |
| **C** | key 只在别的条目正文里 | 上游先触发才可能 |
| **D** | 哪都没有 | 死 |

**D 档必须再拆成两类**，否则会严重误报：

- `use_regex = true` 的键等的是**运行时正文**，静态扫不到是正常的 → **待定点**，不算死键
- 字面 key 才是真死 → 只有它影响 exit code

> 我们一开始把这两类混在一起统计，得出「D 档 100 条」的结论，实际真死的只有 6 条。这个教训写进了 `references/key-reachability.md`。

## 三个已经被骗过一次的坑

改脚本前务必先读这一节。

**1. `$$` 是字面 `$`，`$$1` 不是反向引用。**

真实卡里出现 `command.replace(/(\[\/IDENTITY_INJECTION\])/, '$$1\n' + route)`——这里 `$$1` 是**字面量** `$1`，因为它在注入的 JS 源码里，要多一层转义。直接拿 `/\$1/` 判断"保留了捕获组"会把它误判成安全，从而**漏报**真正会吞令牌的正则。

判定统一走 `scripts/scan-utils.mjs` 的 `keepsCapture()`，它先把 `$$` 还原成占位符再判断。

**2. 警告级不是缺陷。**

`regex-doctor` 的"正文未包裹"是**观察项**，只打 `ℹ️`。早期版本 CLI 对任何 finding 都打 `❌` 并 exit 1，导致 `--json` 显示 `fails: []` 而退出码却是 1，自相矛盾。

**3. 令牌名正则有字符类陷阱。**

`/\[([^\]|\r\n]{2,}?)\s*(?=\||\])/g` 会吞掉反斜杠，把 `[STAT_SET\|...]` 捕获成 `"STAT_SET\"`，于是"正则吞令牌 0 条"——**假阴性**。正确写法要排除反斜杠：

```js
/\[([^\[\]|\\\r\n]{2,}?)\s*(?=\\?\||\])/g
```

## 交付闸门检查项

`gate.mjs` 逐项打印 pass / warn / fail：

- 字面死键率（≥阈值 fail）
- 间接键占比
- 常驻索引覆盖率
- 索引条目是否存在
- 正则 key 可达性
- 空白字段（白写字段检测）
- 过薄条目
- 结构完整性
- 正则吞令牌

## 平台无关的设计原则层

脚本只作用于 RP-Hub，但 `references/design-principles.md` 与 `references/platform-bindings.md` 是**平台无关**的，用于迁移到其它平台（如 SillyTavern）：

- **三条铁律**：① 卡面瘦身；② 单一事实源（世界书拥有正文契约）；③ 状态必须落盘（且要留恢复路径）
- **能力声明 C1–C7**：规范只声明"需要什么能力"，不规定"某平台怎么实现"
  - C1 状态持久化 · C2 正文标记→UI 渲染 · C3 富交互回传 · C4 楼层级存档/还原
  - C5 条件分支渲染 · C6 模板变量替换 · C7 递归触发

关键差异：**RP-Hub 无递归**，ST 有。所以本流程默认假设无递归，把递归当作 ST 上的可选加速器。

## 项目结构

```
SKILL.md                        主入口：流程、闸门项、反模式
references/
  design-principles.md          ★ 平台无关设计原则（三条铁律 + C1–C7）
  platform-bindings.md          ★ 能力 × 平台绑定矩阵、插件依赖
  key-reachability.md           五档可达性方法论 + 工具陷阱
  keyword-design.md             关键词设计
  runtime-facts.md              RP-Hub 运行时事实（含源码行号）
  worldbook-writing-rules.md    世界书写法
scripts/
  rphub-card.mjs                读卡（chara / ccv3 / 嗅探）+ 条目归一化
  gate.mjs                      交付闸门
  key-audit.mjs                 五档可达性
  regex-doctor.mjs              正则 UI 九项边界
  skeleton.mjs                  世界书骨架概览
  scan-utils.mjs                $$ 转义 / 吞令牌判定
tests/
  run-tests.mjs                 一键自检（24 项）
  fixes.mjs / doc-lint.mjs      回归与文档契约
  fixture.mjs                   自造 PNG 卡（chara / ccv3 / 嗅探全覆盖）
  {unit,keylen,split,ap7,scan3,check-guard,final,pipeline}.mjs  按需审计脚本
```

★ = 换平台时最有价值的两份。

## 测试

```bash
node tests/run-tests.mjs     # 全套，24 项
```

自检**默认零外部依赖**：测试卡由 `tests/fixture.mjs` 现场合成 PNG，所以在一台什么卡都没有的机器上照样全绿。第 `[0]` 节专门守这条——任何测试脚本里再写死 `.png`/`.json` 路径会立刻报红。

要拿真实卡额外对拍（可选）：

```bash
RPHUB_CARD=/path/to/card.png node tests/fixes.mjs
```

## 文档里的「范本A/B/C/D/E」

文档中引用的实测数字（如「范本A 常驻索引覆盖 93.4%」）来自几轮真实卡审计。那些卡**不在本仓库里**，名字已泛化——它们只是参考量级，不是让你去找那张卡。

留数字是因为量级本身有用：人物条目中位数在不同卡上分别是 1166 / 1050 / 244 字，差别巨大，所以**只能看卡自己**，不能按固定字数写。

## 贡献

欢迎 PR。请先读 `CONTRIBUTING.md`——**核心要求是改完脚本必须 `node tests/run-tests.mjs` 全绿**，且不要把自检改成依赖某张外部卡。

## 许可

MIT，见 `LICENSE`。

## 说明

本项目是围绕 **RP-Hub**（一个开源的角色扮演站点）的第三方制卡辅助工具，与 RP-Hub 官方无隶属关系。文中引用的 RP-Hub 运行时行为均以公开源码为依据并标注了文件名与行号（见 `references/runtime-facts.md`）。
