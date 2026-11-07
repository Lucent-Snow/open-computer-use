#!/usr/bin/env node

// Real end-to-end check for jev_desktop_run: the built native MCP binary, the
// repository's deterministic fixture app, AX-only observations and the real
// Jev API. No screenshots, no coordinates, no mocked decisions.
//
//   swift build --product OpenComputerUse --product OpenComputerUseFixture
//   TYPESAFE_API_KEY=... HTTPS_PROXY=... node scripts/tests/jev-desktop-e2e.mjs
//
// The fixture is the repository's own headless AX state channel, so this runs
// without a GUI session or Accessibility grant. It is NOT a test of live TCC
// accessibility traversal against a third-party app; see the run record.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { JsonLinePeer, createCuaApi } from "../node-repl/open-computer-use-repl.mjs";
import { jevDesktopRun } from "../node-repl/jev-desktop-run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const NATIVE = path.join(ROOT, ".build", "debug", "OpenComputerUse");
const FIXTURE = path.join(ROOT, ".build", "debug", "OpenComputerUseFixture");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const REQUEST = {
  app: "OpenComputerUseFixture",
  goal: "Set the text field to cats and click the Increment button so the counter reads 1.",
  expected: "Counter: 1",
  require_controls: [{ role: "text field", value: "cats" }],
  text: "cats",
  max_steps: 6,
};

async function runCase(name, args) {
  const namespace = randomUUID();
  const environment = {
    ...process.env,
    OPEN_COMPUTER_USE_FIXTURE_NAMESPACE: namespace,
    OPEN_COMPUTER_USE_FIXTURE_HEADLESS: "1",
    OPEN_COMPUTER_USE_DISABLE_APP_AGENT_PROXY: "1",
    OPEN_COMPUTER_USE_VISUAL_CURSOR: "0",
    OPEN_COMPUTER_USE_ACTION_READ_BACK: "0",
  };
  const stateFile = path.join(os.tmpdir(), `open-computer-use-fixture-${namespace}`, "state.json");
  const fixture = spawn(FIXTURE, [], { env: environment, stdio: "ignore" });
  let native;
  try {
    let ready = false;
    for (let i = 0; i < 80; i += 1) {
      if (existsSync(stateFile)) { ready = true; break; }
      await sleep(100);
    }
    if (!ready) throw new Error("fixture app did not publish its state");
    native = new JsonLinePeer({ command: NATIVE, args: ["mcp"], env: environment });
    await native.initialize();
    const cua = createCuaApi(native, () => ({ write() {}, emitImage() {} }));

    const before = Date.now();
    const result = await jevDesktopRun(args, { cua, environment });
    const wallMs = Date.now() - before;

    // Independent acceptance: read the AX tree again, without trusting the tool.
    const app = await cua.getApp(args.app, { initialState: false });
    const ax = await app.getAXState({ includeScreenshot: false, emit: false, textLimit: "max" });
    const independent = {
      counter_1: ax.includes("Counter: 1"),
      field_cats: /3 text field[^\n]*Value: cats/u.test(ax),
      ax_chars: ax.length,
    };
    return {
      name,
      status: result.status,
      reason: result.reason,
      message: result.message,
      steps: result.steps,
      model_calls: result.model_calls,
      elapsed_ms: result.elapsed_ms,
      wall_ms: wallMs,
      trace: result.trace.map(entry => ({
        step: entry.step,
        operation: entry.operation,
        target: entry.target,
        source: entry.source,
        confidence: entry.confidence,
        decision_ms: entry.decision_ms,
        model: entry.model,
        usage: entry.usage,
        page_changed: entry.page_changed,
      })),
      post_ax: result.post?.observation?.text ?? "",
      independent,
    };
  } finally {
    native?.close();
    fixture.kill();
  }
}

async function main() {
  for (const binary of [NATIVE, FIXTURE]) {
    if (!existsSync(binary)) throw new Error(`missing ${binary}; run swift build first`);
  }
  if (!process.env.TYPESAFE_API_KEY && !process.env.JEV_KEY) {
    throw new Error("set TYPESAFE_API_KEY (or JEV_KEY) for the real Jev call");
  }
  const cases = [
    await runCase("jev", REQUEST),
    await runCase("deterministic", {
      ...REQUEST,
      deterministic: [
        { text: "fixture-input", operation: "TYPE_TEXT" },
        { text: "Increment", operation: "CLICK" },
      ],
    }),
  ];
  const report = { at: new Date().toISOString(), native_version: "1.1.4", cases };
  const output = process.env.JEV_E2E_OUTPUT ?? path.join(os.tmpdir(), `jev-desktop-e2e-${Date.now()}.json`);
  writeFileSync(output, JSON.stringify(report, null, 2));
  for (const item of cases) {
    console.log(`[${item.name}] ${item.status}/${item.reason} steps=${item.steps} model_calls=${item.model_calls} elapsed=${item.elapsed_ms}ms wall=${item.wall_ms}ms`);
    console.log(`  trace: ${item.trace.map(entry => `${entry.operation}@${entry.target}(${entry.source},${entry.decision_ms}ms)`).join(" -> ") || "(none)"}`);
    console.log(`  independent AX: counter_1=${item.independent.counter_1} field_cats=${item.independent.field_cats}`);
  }
  console.log(`report: ${output}`);

  const [jev, deterministic] = cases;
  const ok = jev.status === "verified_done" && jev.model_calls >= 1 &&
    deterministic.status === "verified_done" && deterministic.model_calls === 0 &&
    cases.every(item => item.independent.counter_1 && item.independent.field_cats);
  if (!ok) {
    console.error("E2E FAILED: see report for traces");
    process.exitCode = 1;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
