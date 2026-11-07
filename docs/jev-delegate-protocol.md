# Jev 委派协议 v0.1（跨实现契约）

`jev_desktop_run`（Node / macOS AX）与 `jev_browser_run`（BrowserSkill fork，Rust / VOM）分别独立完成并通过真实 Jev API 实测。两者的共性是**决策契约与不变量**，不是代码：观察解析、RPC 形态、原生动作 API 完全不同，硬做跨语言「共用 SDK」只会得到没有复用价值的薄包装。因此共享物落地为：一份规范 + 一组可执行 conformance 向量 + 两个实现各自的 CI 自检。

Canonical 规范位于工作区 `jev-integration/protocol/SPEC.md`；本文是 OCU 侧的摘要与 CI 入口。

## 共享的不变量

| 规则 | 内容 |
| --- | --- |
| 一次请求多个 head | `operation` / `click_target` / `type_text_target` 并行求，只消费与所选 operation 匹配的 target head。 |
| 全量概率分布 | `choice` 必须是 offered id；`probabilities` 覆盖所有 offered id、每个在 `[0,1]`、总和在 `1±0.02`、`choice` 必须是最大概率。否则 `needs_llm / invalid_choice`，不猜、不执行。 |
| 观察时效 | 数字 index 绑定本次 AX 观察哈希，执行前必须能在当前观察候选集里找到目标，否则 `unknown_target`。 |
| 重试策略 | 只读 AX 观察最多重试 4 次；已执行的动作绝不重试。 |
| 完成由代码判定 | `expected` 必须是动作后**新出现**的非控件证据（或 App / Window 头行），且至少执行过一个动作。控件 value、动作前已存在的证据、模型 `DONE` 都不算。`require_controls` 只是必要条件。 |
| 响应 | `status` / `reason` / `message` / `goal` / `expected` / `steps` / `model_calls` / `elapsed_ms` / `trace` / `post`。 |

已知差异（AX vs VOM、`OCU_JEV=1` vs `BSK_JEV=1`、确定性 `query→action` / `require_controls` vs `SCROLL_DOWN` / 导航竞态重试）留在各自的适配层。若出现第三个后端，应新增适配层并跑同一套向量，而不是改写核心。

## 向量与 CI

`scripts/tests/fixtures/jev-protocol-vectors.json` 是 canonical `protocol/vectors.json` 的逐字节副本，包含 7 个决策时刻：`two_step_form`、`result_page_evidence`、`control_value_is_not_evidence`、`preexisting_evidence`、`partial_probabilities`、`stale_target`、`done_unverified`。

`scripts/node-repl/jev-protocol-selfcheck.mjs` 是 OCU 侧唯一的向量校验逻辑：用 `parseAXState` 解析向量里的原始 AX 文本、用生产函数 `buildQuestions` / `choose` / `verified` 断言 `heads` / `operation` / `target` / `decision_error` / `verified`。`scripts/node-repl/jev-protocol.test.mjs` 在 `node --test` 中逐个向量执行它，跨语言 runner 也直接 import 同一模块，避免两套近似断言。

```sh
node --test scripts/node-repl/jev-protocol.test.mjs
# 两个实现一起校验（同时刷新两份 fixture 副本）
node jev-integration/protocol/conformance.mjs
```

本机实测：`CONFORMANCE: PASS (7 vectors, 2 implementations)`；OCU 侧 8 个测试通过（7 个向量 + 1 个完整性检查），Rust 侧 1 个测试通过。runner 会在两份副本与 canonical 文件不一致时同步并校验，字节不一致即失败。

## 边界

协议不覆盖截图 / OCR / 坐标动作，也不规定 LLM 与工具之间的传输方式（MCP stdio 只是当前实现）。v0.1 向量只覆盖决策与验收不变量；完整循环、超时、取消与费用计量由各实现自己的单测和 M3 对照报告负责。
