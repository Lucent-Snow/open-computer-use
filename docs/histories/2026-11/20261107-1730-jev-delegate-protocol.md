# M3 对照实验与 M4 语言无关协议落地

## 用户诉求

按计划把 M2 之后的所有阶段做完：同后端公平对照 LLM 直调原生工具与一次委派 Jev，再抽象两个实现的共性；打磨和消融实验明确推迟到全部阶段完成之后。

## 实现与判断

- **M3**：`jev-integration/m3_compare.py` 固定同一网关、同一上层模型 `gpt-5.6-luna`、同一 fixture 与同一独立验收，2 后端 × 2 组 × 3 次 = 12 次全成功。baseline 允许批处理（OCU 用持久 `js` REPL 一次调用批量动作，BSK 用 `bsk_plan`），避免把「每步一次 LLM 调用」做成稻草人基线。零副作用信号判断 `quick_check` 只从当前 turn 的工具回复里读，避免每轮 `sync` 刷新 `observation_id` 干扰被测会话。
- **结论**：委派组在两个后端都降到 1 次 LLM / 1 次工具调用，墙钟 BSK 18173→9600 ms、OCU 8413.7→7470.3 ms；但 OCU 总模型 token 从 2589.7 升到 5026，因为 Jev 每步要带完整 AX state。网关无 cost 字段，当时只把 token 当费用代理。可读版见 `jev-integration/protocol/m3-summary.md`，原始 transcript 在 `m3_report.json`。
- **同日追加的成本实测纠正（以此为准）**：固定单一任务 T1 `submit-with-evidence`，4 条件 × 5 次 = 20/20 成功，按公开单价（LLM $0.20/$1.20 每 1M 输入/输出、Jev $0.042/1M 输入且输出免费、1 USD=6.6713 CNY）分别计价：BSK 委派成本为 baseline 的 0.167×（省 83.3%、时间省 39.9%），OCU 委派 token 涨到 1.95× 但成本只要 0.599×（省 40.1%、时间省 12.5%）。**token 多不等于更贵**，混合模型必须按模型分别计价。三种单价假设方向一致。见工作区 `cost_compare.py`、`pricing.json`、`cost_report.json` 与 `protocol/m3-summary.md`。
- **M4 关键判断**：Rust/VOM 与 JS/AX 的观察解析、RPC 形态、动作 API 完全不同，共性只在契约与不变量，硬做跨语言共用 SDK 没有复用价值。因此落地为「一份规范 + 一组 conformance 向量 + 两个实现各自 CI 自检」，不新增运行时依赖。
- **本仓库侧落地**：`scripts/tests/fixtures/jev-protocol-vectors.json`（canonical 的逐字节副本）、`scripts/node-repl/jev-protocol-selfcheck.mjs`（唯一的 JS 向量校验逻辑）、`scripts/node-repl/jev-protocol.test.mjs`（CI 自检）、`docs/jev-delegate-protocol.md`。跨语言 runner `protocol/conformance.mjs` 直接 import 同一个 selfcheck 模块，保证 CI 与 runner 跑的是同一段断言。

## 验证

- `node --test scripts/node-repl/jev-protocol.test.mjs`：8/8 通过（7 向量 + 1 完整性检查）。
- `node jev-integration/protocol/conformance.mjs`：`CONFORMANCE: PASS (7 vectors, 2 implementations)`；同时校验并同步两份 fixture 副本，Rust 侧 `jev_protocol_vectors_are_satisfied` 1 个测试通过。
- 全量 `node --test scripts/node-repl/*.test.mjs scripts/tests/*.test.mjs`：76 项，75 通过、1 项真实 API 冒烟按需跳过、0 失败（比 M2 快照多 8 项，即协议自检）。
- `node --check` 覆盖所有 `scripts/**/*.mjs`；`check-docs.sh`、`check-action-pinning.sh`、`validate-github-release-notes.mjs --tag v1.1.4 --notes-only` 均通过。
- `scripts/ci.sh` 在第二个检查 `check-repo-hygiene.sh` 处即停止：它要求 `.editorconfig`、`.github/workflows/ci.yml`、`.markdownlint.json` 等文件，但 `upstream/main` 的 tree 里同样没有这些文件。属于上游既有基线问题，与本次改动无关；因此逐条单独运行了其余门禁，未擅自补造上游文件。

## 主要文件

- `scripts/node-repl/jev-protocol-selfcheck.mjs`、`scripts/node-repl/jev-protocol.test.mjs`
- `scripts/tests/fixtures/jev-protocol-vectors.json`
- `docs/jev-delegate-protocol.md`
- 工作区：`jev-integration/protocol/{SPEC.md,vectors.json,conformance.mjs,m3-summary.md}`、`jev-integration/m3_compare.py`、`m3_report.json`

## 遗留

- 打磨与消融实验尚未执行（用户明确要求在所有阶段完成后再做）；候选开关包括 `deterministic`、`require_controls`、观察重试次数、候选上限。
- 真实第三方 App 的 TCC 动作链路、更长多步任务、跨模型与失败恢复率未纳入 M3。
- SPEC.md / vectors.json 的 canonical 位置在工作区，不在任一 fork；两个仓库只持有副本与自检，改动向量需要同步三处。
