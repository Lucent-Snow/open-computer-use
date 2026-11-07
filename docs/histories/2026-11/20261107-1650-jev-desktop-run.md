# 新增 jev_desktop_run：AX-only 的 Jev 委派工具

## 用户诉求

按既定计划继续推进：给 Open Computer Use 增加一个由上层 LLM 调用的高层 Jev 委派工具，仅用 macOS 辅助功能，不改 Swift，保留现有工具，并在本地实测。

## 实现与判断

- 在 `scripts/node-repl/` 新增 `jev-desktop-run.mjs`，复用 `createCuaApi` / `JsonLinePeer` 的 app-bound API，不改 Swift 侧。`open-computer-use-repl.mjs` 只增加 `OCU_JEV=1` 门控的工具注册与分发，`js` / `js_reset` 原样保留；npm 打包、Codex 插件安装脚本和 CLI 测试脚手架同步加入新模块。
- 一次 System One 请求并行求 operation 与各 target head，只消费匹配 head；索引绑定本次 AX 观察 ID；动作从不重试，观察只读可重试。
- 完成判定由代码做：`expected` 必须是动作后新增的**非控件**证据，`require_controls` 只是必要条件。这条规则是在实测里发现「只点一下按钮就可能被误判完成」之后补上的，并加了回归测试。
- 目标明确唯一时走确定性 `query→action`，该步不调用 Jev；fixture 不支持 `query` 时退化为当前 AX 观察里的唯一匹配。
- 解析器同时支持 fixture 的英文合成 AX 行与真实 macOS 本地化 AX 行。最初只按 ` ID: ` 切分，导致 `2 static text ID: ...` 这类行的 `Value:` 全部丢失、控件验收恒假；改为按 `\bID:` 切分后修复。

## 验证

- `node --test scripts/node-repl/*.test.mjs scripts/tests/*.test.mjs`：68 项，67 通过、1 项真实 API 冒烟按需跳过、0 失败；原有 48 项回归未受影响。
- 真实 Jev API 冒烟通过（`jev-1.14.0`，约 1.3 s）。
- 真机 E2E（`scripts/tests/jev-desktop-e2e.mjs`）：Jev 路径 2 步 / 2 次模型调用 / 3379 ms，确定性路径 2 步 / 0 次模型调用 / 363 ms；两条路径均由独立 AX 复查确认 `Counter: 1` 与字段值 `cats`。
- 真实 TCC 辅助功能只读快照（`accessibility=granted`）：720 行解析为 60 个有限候选，请求构造正确。未对第三方 App 执行动作。

## 主要文件

- `scripts/node-repl/jev-desktop-run.mjs`
- `scripts/node-repl/jev-desktop-run.test.mjs`
- `scripts/node-repl/open-computer-use-repl.mjs`
- `scripts/tests/jev-desktop-e2e.mjs`
- `scripts/npm/build-packages.mjs`、`scripts/install-codex-plugin.sh`、`scripts/node-repl/open-computer-use-cli.test.mjs`
- `docs/jev-desktop-run.md`

## 遗留

- 动作实测基于仓库自带的 headless fixture（合成 AX 状态通道），不是对第三方 App 的真实 TCC 遍历；真实链路只验证到观察层。
- 本地化 role 词表按本机样本整理，其他系统语言可能有未枚举 role。
- 与 BrowserSkill 侧的共性抽象、以及 LLM 直调对照实验，属于后续 M3 / M4，未在本变更里做；两者已于同日完成，见 `20261107-1730-jev-delegate-protocol.md`。
