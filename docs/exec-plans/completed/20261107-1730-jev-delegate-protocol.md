# 执行计划：M3 对照实验 + M4 语言无关协议（已完成）

状态：已完成，2026-11-07。说明见 [协议文档](../../jev-delegate-protocol.md)，变更记录见 [history](../../histories/2026-11/20261107-1730-jev-delegate-protocol.md)。

## 目标与边界

在 M1（BrowserSkill / Rust / VOM）与 M2（OCU / Node / AX）都完成真实 Jev 实测之后：给出同后端公平对照证据；再从两个异构实现里抽出可验证的共享契约。不新增跨语言运行时依赖，不改 Swift，不做打磨与消融（用户要求放到所有阶段之后）。

## 步骤与验收

1. 设计并实现 M3 harness：固定同一网关/模型/任务/独立验收，baseline 允许批处理。验收：12 次运行全部有独立验收结果，且 baseline 不是「每步一次 LLM 调用」。
2. 跑全量实验并汇总成功率、墙钟、LLM/工具/Jev 调用数、tokens、工具错误。验收：报告落盘且能复现负向结论（OCU delegate 总 token 上升）。
3. 写 canonical `protocol/SPEC.md` 与 7 个 conformance 向量，覆盖一次请求多 head、只消费匹配 head、全量概率校验、陈旧 target、控件 value 不算证据、动作前已有证据不算、模型 DONE 不算完成。验收：向量能被两种原始观察格式（VOM / AX）消费。
4. 两个 fork 各持一份逐字节 fixture 副本，Rust 用 `cargo test`、Node 用 `node --test` 自检；JS 校验逻辑只保留一份并被 runner 复用。验收：runner 在副本漂移时同步并校验，任一实现违约即 FAIL。
5. 补齐两个仓库的协议文档、history / 执行计划与 notes。验收：文档指向的每条命令本地可执行。

## 明确不做

- 不做跨语言共用 SDK：两个实现没有可复用的运行时代码，共性只在契约。
- 不做货币费用结论：网关无 cost 字段，token 只作代理。
- 不擅自修复上游 `swift test` 里与本次改动无关的 Swift 6.4 编译失败。
- 不做打磨与消融实验（推迟）。
