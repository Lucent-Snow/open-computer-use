# jev_desktop_run：AX-only 的 Jev 委派工具

状态：实验性，默认关闭，需要 `OCU_JEV=1`。不影响 `js` / `js_reset` 两个原有工具，也不修改任何 Swift 代码。

## 解决什么问题

上层 LLM 在做桌面 GUI 任务时，通常每做一步都要重新观察、重新推理、重新调用工具。这个工具把「观察 → 在有限候选里选一个操作 → 执行 → 再观察」的循环收进一次工具调用：LLM 只负责理解目标、决定是否委派、提供文本和接管；Jev 只负责在给定状态和有限候选中做局部选择；观察、候选构造、执行、时效检查和结果验收都由代码完成。

与 `jev_browser_run`（BrowserSkill fork 的同构实现）共用同一套契约，两者是 M3 对照实验的两个后端。

## 契约

调用参数：

| 字段 | 说明 |
| --- | --- |
| `app` | 已运行的 App 名称或 bundle ID。 |
| `goal` | 自然语言目标。 |
| `expected` | 完成后必须**新出现**的字面证据；只在非控件文本 + App/Window 头行里找。 |
| `require_controls` | 可选的精确控件值条件，例如 `{role:"text field", value:"cats"}`。它是必要条件，**不是**完成证据本身。 |
| `text` | `TYPE_TEXT` 用的文本，由调用方提供；Jev 不生成开放文本。 |
| `max_steps` | 动作预算，默认 6，上限 12。 |
| `deterministic` | 可选的、目标明确唯一的 `query→action` 提示链，按顺序消费。 |

返回 `status` / `reason` / `message` / `steps` / `model_calls` / `elapsed_ms` / `trace` / `post`，`status` 取 `verified_done`、`needs_llm`、`blocked`、`budget_exhausted` 之一。

## 循环与边界

1. 每步只用 `getAXState({includeScreenshot:false})` 观察，不截图、不 OCR、不用坐标。观察是只读的，失败最多重试 4 次；**动作从不重试**。
2. 从 AX 文本解析候选。fixture 的英文合成行与真实 macOS 的本地化 AX 行（中英混合 role、`(settable, string)` traits、无 `ID:` 段）都能解析；候选上限 60，真实控件优先于容器。
3. 若 `deterministic` 提示在当前步唯一命中，直接走 `query→action`（fixture 不支持 `query`，退化为当前 AX 观察里的唯一匹配），**该步不调用 Jev**。歧义或不支持时正常交给 Jev。
4. 否则一次 System One 请求里并行求解 `operation` 与各 `type_text_target` / `click_target` head，只消费与所选 operation 匹配的 target head。分布不完整、置信度越界、索引不在本次观察里，都直接交回 LLM，不猜、不执行。
5. 执行走原生 `app.click` / `app.setValue` / `app.scroll`，元素索引绑定本次观察 ID。
6. 完成判定由代码做：`expected` 必须是动作后在**非控件**文本里新出现的，且 `require_controls` 全部满足。控件 value 单独出现不算完成；Jev 答 `DONE` 也不能替代验收。
7. 连续 3 次动作后 AX 树不变 → `needs_llm / no_progress`；预算耗尽 → `budget_exhausted`。
8. `CLICK` 不强制 `click_method=accessibility`（fixture 明确拒绝该值），真实 App 可自行指定。发送、删除、支付等高后果动作仍需上层确认。

## 运行

```sh
swift build --product OpenComputerUse --product OpenComputerUseFixture
node --test scripts/node-repl/*.test.mjs scripts/tests/*.test.mjs
TYPESAFE_API_KEY=... HTTPS_PROXY=... node scripts/tests/jev-desktop-e2e.mjs
```

E2E 需要 `OCU_JEV` 只在 MCP server 侧生效；脚本直接调用模块，不依赖门控。真实 Jev 端点必须走代理（直连会返回 451），`curl` 继承 `HTTPS_PROXY`。

## 本地实测（2026-11-07）

headless `OpenComputerUseFixture` + 编译后的 native MCP + 真实 `jev-1.14.0`，任务「把文本栏设为 cats 并点 Increment 使计数器变成 1」：

| 路径 | 结果 | 步数 | 模型调用 | 端到端 |
| --- | --- | --- | --- | --- |
| Jev 决策 | `verified_done / expected_observed` | 2（`TYPE_TEXT@3` → `CLICK@1`） | 2（1347 ms、1646 ms） | 3379 ms |
| 确定性 query→action | `verified_done / expected_observed` | 2 | 0 | 363 ms |

每条路径之后都重新读取 AX 独立复查：`Counter: 1` 与 `Value: cats` 均成立。离线 67 项 Node 测试通过（1 项真实 API 冒烟按需跳过），原有 48 项回归未受影响。

另外用本机真实 TCC 辅助功能（`doctor` 报 `accessibility=granted`）对运行中的浏览器做了一次**只读** AX 快照：720 行解析为 60 个有限候选（link 16 / pop up button 21 / button 23），能正确生成 `operation` + `click_target` 请求。

## 已知边界

- fixture 走的是仓库自带的合成 AX 状态通道，在权限检查之前返回；**上述动作实测不是对第三方 App 的真实 TCC AX 遍历**。真实链路只验证到观察与候选构造层，没有对用户正在使用的窗口执行动作（避免干扰桌面）。
- fixture 明确拒绝 `query`，因此确定性路径在 E2E 里走的是「当前 AX 观察唯一匹配」，不是 `query` 索引；单测另行覆盖了 `query` 唯一命中与陈旧索引被拒的分支。
- 本地化 role 词表按本机样本整理，其他系统语言可能出现未枚举 role；这类行会保留为原样 role，不会导致整棵树解析失败，但候选优先级可能下降。
- `require_controls` 是桌面侧为「两步任务」增加的必要扩展；浏览器侧的 `jev_browser_run` 用结果页独有字面证据达到同样目的。两者共性与差异在 [Jev 委派协议 v0.1](jev-delegate-protocol.md) 里统一说明，并由 `scripts/node-repl/jev-protocol.test.mjs` 对 7 个跨语言向量做 CI 自检。
- M3 同后端对照实验见工作区 `jev-integration/protocol/m3-summary.md`。注意：OCU 上总模型 token 虽然涨到 1.95×，但按公开单价折算后委派**成本反而降到 0.599×**（省 40.1%）、时间省 12.5% —— Jev 输入单价仅 LLM 的约 1/5 且输出免费，所以不能用总 token 判断费用。
