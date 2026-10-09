# 贡献指南

感谢愿意改进这套流程。改动前请先读这一页，尤其是**前两条硬要求**。

## 硬要求：只推这个仓库

```bash
git push origin main      # origin = https://github.com/qq1049323397/rphub-card-flow
```

这套 skill 在开发机上有**三份副本**，只有第三份是发布口：

| 副本 | 性质 | 推不推 |
|---|---|---|
| 卡仓库里的 `rphub-card-flow/` 子目录 | 开发时的源副本，跟着卡仓库走 | ❌ 不推 |
| `~/.dsh/skills/rphub-card-flow/` | 本机实际生效的安装副本 | ❌ 不推 |
| 本仓库（独立 git 仓库） | **唯一的发布口** | ✅ 只推这里 |

改完 skill 要把同一批文件同步到三份，然后**只在独立仓库提交推送**。

⚠️ 同步时**不要用 `rsync --delete`**。本仓库有 5 个独有文件——`LICENSE`、
`CONTRIBUTING.md`、`.gitignore`、`.github/workflows/test.yml`、`.github/ci-test.yml`——
它们不在另外两份里，`--delete` 会把它们静默删掉，测试还是全绿，你看不出来。
逐个 `cp` 覆盖改动的那几个文件即可。

## 硬要求：改完必须自检全绿

```bash
node tests/run-tests.mjs     # 必须 exit 0，且「失败 0」
```

用例数会随版本增长，这里不写死数字；判据是**失败 0**。

CI 也会跑这一条，红灯的 PR 不会合。

> ⚠️ CI 配置目前放在 `.github/ci-test.yml`（**尚未生效**）。GitHub 只认
> `.github/workflows/` 下的文件，而推送它的 token 缺 `workflow` 权限。
> 启用方法见该文件开头的说明。**没有 CI 也不影响贡献**——本地跑上面那条命令即可。

## 硬要求：不要把自检改成依赖外部卡

这套工具要给别的机器、别人用，**自检默认零外部依赖**——测试卡由 `tests/fixture.mjs` 现场合成 PNG。

所以：

- ❌ 不要在 `tests/*.mjs` 里写死任何 `.png` / `.json` 路径
- ✅ 需要卡的脚本用 `process.argv` 收路径，没给就打印用法并 `exit 2`
- ✅ 测试卡用 `tests/fixture.mjs` 的 `minimalCard()` / `cleanCard()` / `writeCardPng()`
- ✅ 想对拍真实卡，走可选环境变量（如 `RPHUB_CARD=`），且**缺省必须跳过而不是报错**

自检第 `[0]` 节会静态扫描并拦住写死的卡路径。这条规则不是洁癖：之前自检依赖过一张真实卡，那张卡被删后自检就常年报红，等于没有自检。

## 三个已被骗过一次的坑（改相关代码前必读）

**1. `$$` 是字面 `$`。** 判定"正则是否保留了捕获组"必须走 `scripts/scan-utils.mjs` 的 `keepsCapture()`，它会先把 `$$` 还原。直接 `/\$1/` 会漏报真正吞令牌的正则。

**2. 警告级 ≠ 缺陷。** 观察项打 `ℹ️` 且**不影响 exit code**。曾经 CLI 对任何 finding 都打 `❌` 并 exit 1，与 `--json` 的 `fails: []` 自相矛盾。

**3. 令牌名正则要排除反斜杠。**

```js
/\[([^\[\]|\\\r\n]{2,}?)\s*(?=\\?\||\])/g   // 对
/\[([^\]|\r\n]{2,}?)\s*(?=\||\])/g           // 错：会吞掉 \
```

## 改了脚本要跑的三件事

```bash
node tests/run-tests.mjs     # 全套
node tests/fixes.mjs         # 三缺陷回归
node tests/doc-lint.mjs      # 文档契约
```

## 文档改动

`tests/doc-lint.mjs` 会检查文档契约，其中一条是：`references/design-principles.md` **必须保持平台无关**，不得出现具体平台标识（如 `RP-Hub`、`SillyTavern`、`markdownOnly`、`useRegex`、`scanDepth` 等）。平台相关的实现细节请写进 `references/platform-bindings.md`。

改 `SKILL.md` 的 `version` 字段时，doc-lint 用 `>=` 比较，向前兼容。

## 提交 PR

1. 改之前先跑一遍自检，确认基线是绿的
2. 一个 PR 只做一件事
3. commit message 说清**为什么**改，而不只是改了什么
4. PR 描述里贴上自检输出

## 目录约定

| 位置 | 放什么 |
|---|---|
| `scripts/` | 会被复用的工具，导出函数 + 可 CLI 调用 |
| `tests/` | `run-tests.mjs` 里被调用的断言；`fixture.mjs` 造测试数据 |
| `references/` | 给人和 AI 读的文档。平台无关的与平台绑定的要分开 |

## 关于新增平台支持

欢迎补充其它平台（Risu、酒馆各分支等）的绑定关系。做法是在 `references/platform-bindings.md` 里补矩阵行，并按 **C1–C7 能力**描述它——不要在设计原则层里写某平台的专有字段名。
