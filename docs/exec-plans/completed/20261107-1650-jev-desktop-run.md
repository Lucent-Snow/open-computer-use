# 执行计划：AX-only 的 Jev 委派工具（已完成）

状态：已完成，2026-11-07。关联说明见 [工具契约](../../jev-desktop-run.md)，变更记录见 [history](../../histories/2026-11/20261107-1650-jev-desktop-run.md)。

## 目标与边界

在 Node adapter 层新增一个 LLM 可调用的高层委派工具，循环内完成观察、有限候选、一次 Jev 决策、原生执行、再观察和代码验收。仅 AX，不用截图 / OCR / 坐标；不改 Swift；`js` / `js_reset` 不变；默认关闭。

## 步骤与验收

1. fork 上游仓库、建立独立分支，编译 `OpenComputerUse` 与 `OpenComputerUseFixture`。验收：native `version` 可执行，fixture 能发布状态文件。
2. 打通 native MCP 的 AX-only 观察与 `set_value` / `click` 语义动作。验收：AX 文本可读，动作后 `Counter` 与字段值变化。
3. 实现解析、questions、答案校验、执行、验收与状态机，并注册为 env 门控的第三个 MCP 工具。验收：离线单测覆盖四个终态、只消费匹配 head、陈旧索引拒绝、控件值不能单独证明完成。
4. 同步 npm 打包清单、Codex 插件安装脚本与 CLI 测试脚手架。验收：原有回归全绿。
5. 用真实 Jev API 跑 headless E2E，两条路径（Jev / 确定性）分别记录步数、模型调用、延时，并独立复查 AX。验收：均为 `verified_done`，Jev 路径模型调用 > 0，确定性路径 = 0。
6. 补真实 TCC AX 的**只读**观察验证。验收：本地化 AX 行能生成有限候选与请求。

## 明确不做

- 不对用户正在使用的第三方 App 窗口执行动作。
- 不引入 AppleScript / JXA 后端：与仓库「签名 App 权限身份」「避免 AppleScript」的既有设计冲突。
- 不做跨语言共用 SDK 或 LLM 对照实验，留给 M3 / M4。
