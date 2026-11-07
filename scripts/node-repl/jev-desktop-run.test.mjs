import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuestions,
  choose,
  httpDecide,
  jevDesktopRun,
  jevEnabled,
  jevToolDefinition,
  parseAXState,
  validateChoice,
  verified,
} from "./jev-desktop-run.mjs";
import { toolDefinitions } from "./open-computer-use-repl.mjs";

const FIXTURE_AX = `App=OpenComputerUseFixture (pid 1234)
Window: "OpenComputerUseFixture", App: OpenComputerUseFixture.
0 standard window OpenComputerUseFixture ID: fixture-window Secondary Actions: Raise Frame: x=0, y=0, w=640, h=667
    1 button Increment Counter ID: fixture-increment Frame: x=13, y=71, w=148, h=32
    2 static text ID: fixture-counter-label Value: Counter: 0 Frame: x=18, y=108, w=68, h=16
    3 text field ID: fixture-input Value: seed Frame: x=20, y=164, w=320, h=21
    4 static text ID: fixture-key-label Value: Last key: none Frame: x=18, y=197, w=92, h=16
    5 group Key Capture ID: fixture-key-capture Frame: x=20, y=225, w=320, h=72
    6 static text ID: fixture-scroll-status Value: Scroll offset: 0 Frame: x=18, y=309, w=92, h=16
    7 scroll area ID: fixture-scroll-view Secondary Actions: Scroll Up, Scroll Down Frame: x=20, y=337, w=520, h=150
    8 static text ID: fixture-drag-status Value: Last drag: none Frame: x=18, y=499, w=98, h=16
    9 group Drag Pad ID: fixture-drag-pad Frame: x=20, y=527, w=320, h=120
Screenshot omitted by include_screenshot=false`;

const REQUEST = {
  app: "OpenComputerUseFixture",
  goal: "Set the text field to cats and click the Increment button so the counter reads 1.",
  expected: "Counter: 1",
  require_controls: [{ role: "text field", value: "cats" }],
  text: "cats",
  max_steps: 6,
};

/** A two-step AX backend with no targeted query, exactly like the fixture. */
function mockCua() {
  let state = FIXTURE_AX;
  const actions = [];
  const app = {
    async getAXState() { return state; },
    async setValue(index, value) {
      actions.push(["setValue", index, value]);
      state = state.replace(/(3 text field ID: fixture-input Value: )\S+/, `$1${value}`);
    },
    async click(index) {
      actions.push(["click", index]);
      state = state.replace(/Value: Counter: \d+/, "Value: Counter: 1");
    },
    async scroll() { actions.push(["scroll"]); },
  };
  return { cua: { getApp: async () => app }, actions, get state() { return state; } };
}

/** Build a well-formed answer for every head in the request, because the real
 *  API returns a full probability distribution rather than one id. */
function answer(operation, targetHead, targetId) {
  return async body => {
    const answers = {};
    for (const [head, question] of Object.entries(body.questions)) {
      const ids = Object.keys(question.criteria);
      const picked = head === "operation" ? operation : head === targetHead ? targetId : ids[0];
      const probabilities = {};
      const others = ids.length - 1;
      for (const id of ids) probabilities[id] = id === picked ? 1 - 0.01 * others : 0.01;
      answers[head] = { choice: picked, confidence: 0.95, probabilities };
    }
    return { answers, model: "jev-test", usage: { input_tokens: 10, output_tokens: 4 } };
  };
}

const injection = () => ({ wait: async () => {}, now: () => 0 });

test("parseAXState separates controls from completion evidence", () => {
  const observation = parseAXState(FIXTURE_AX);
  assert.equal(observation.app, "OpenComputerUseFixture");
  assert.ok(observation.candidates.some(item => item.index === "1" && item.role === "button"));
  assert.ok(observation.candidates.some(item => item.index === "3" && item.editable));
  assert.ok(observation.evidence.includes("Counter: 0"));
  assert.ok(!observation.evidence.includes("seed"), "a control value must not be completion evidence");
  assert.ok(!observation.evidence.includes("fixture-input"));
  assert.match(observation.observationId, /^ax-[0-9a-f]{12}$/u);
});

const LIVE_AX = `App=com.google.Chrome (pid 1)
Window: "Demo", App: Google Chrome.
0 标准窗口 Demo, Secondary Actions: Raise
\t1 container (settable, string) Demo
\t\t5 滚动区
\t\t\t6 HTML 内容 Demo, URL: https://example.com
\t\t\t\t10 link [跳到内容](https://example.com)
\t\t\t\t14 弹出式按钮 切换模式
\t\t\t\t16 按钮 (expanded) 隐藏侧边栏
\t\t\t\t20 文本输入区 Value: hello
\t\t\t\t21 静态文本 Value: Saved!`;

test("localized live-AX rows parse into finite candidates and evidence", () => {
  const observation = parseAXState(LIVE_AX);
  const roles = observation.candidates.map(item => item.role);
  assert.ok(roles.includes("button"), JSON.stringify(observation.candidates));
  assert.ok(roles.includes("pop up button"));
  assert.ok(roles.includes("link"));
  assert.ok(roles.includes("text area"));
  assert.ok(!roles.includes("static text"), "static text is evidence, not a control");
  assert.equal(observation.candidates.find(item => item.index === "20")?.value, "hello");
  assert.ok(observation.evidence.includes("Saved!"));
  assert.ok(observation.candidates.every(item => item.identifier.startsWith("ax-")), "live AX has no ID: segment");
  assert.ok(observation.candidates.length <= 60);
});

test("one request carries the operation head and matching target heads", () => {
  const body = buildQuestions(REQUEST, parseAXState(FIXTURE_AX), []);
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(Object.keys(body.questions).sort(), ["click_target", "operation", "type_text_target"]);
  assert.ok(body.questions.operation.criteria.TYPE_TEXT);
  assert.ok(body.questions.click_target.criteria["1"]);
  assert.ok(body.questions.type_text_target.criteria["3"]);
  assert.ok(!body.questions.type_text_target.criteria["1"], "non-editable elements are not offered for TYPE_TEXT");
  assert.ok(body.state.elements.every(element => Number.isInteger(Number(element.index))));
});

test("validateChoice rejects a partial probability distribution", () => {
  assert.throws(
    () => validateChoice({ choice: "1", confidence: 0.9, probabilities: { 1: 1 } }, ["1", "3"]),
    /do not cover the offered ids/u,
  );
  assert.throws(
    () => validateChoice({ choice: "3", confidence: 0.9, probabilities: { 1: 0.8, 3: 0.2 } }, ["1", "3"]),
    /most probable/u,
  );
});

test("only the target head matching the chosen operation is consumed", () => {
  const observation = parseAXState(FIXTURE_AX);
  const body = buildQuestions(REQUEST, observation, []);
  const answers = {
    operation: { choice: "TYPE_TEXT", confidence: 0.9, probabilities: { CLICK: 0.01, TYPE_TEXT: 0.95, SCROLL_DOWN: 0.01, WAIT: 0.01, DONE: 0.02 } },
    type_text_target: { choice: "3", confidence: 0.9, probabilities: { 3: 1 } },
    click_target: { choice: "not-an-id", probabilities: {} },
  };
  const decision = choose(body, answers, observation);
  assert.equal(decision.operation, "TYPE_TEXT");
  assert.equal(decision.target, "3");
  assert.equal(decision.reference, "3");
});

test("completion requires new non-control evidence after an action", () => {
  const before = parseAXState(FIXTURE_AX).evidence;
  const after = parseAXState(FIXTURE_AX.replace("Counter: 0", "Counter: 1")).evidence;
  assert.equal(verified("Counter: 1", before, "", [{ step: 0 }]), false);
  assert.equal(verified("Counter: 1", after, before, [{ step: 0 }]), true);
  assert.equal(verified("Counter: 1", after, after, [{ step: 0 }]), false, "pre-existing evidence is not proof");
  assert.equal(verified("cats", parseAXState(FIXTURE_AX.replace("Value: seed", "Value: cats")).evidence, before, [{ step: 0 }]), false);
});

test("a two-step Jev loop reaches verified_done with two model calls", async () => {
  const mock = mockCua();
  let call = 0;
  const decide = async body => {
    call += 1;
    return (call === 1 ? answer("TYPE_TEXT", "type_text_target", "3") : answer("CLICK", "click_target", "1"))(body);
  };
  const result = await jevDesktopRun(REQUEST, { cua: mock.cua, ...injection(), decide });
  assert.equal(result.status, "verified_done", JSON.stringify(result));
  assert.equal(result.reason, "expected_observed");
  assert.equal(result.steps, 2);
  assert.equal(result.model_calls, 2);
  assert.deepEqual(result.trace.map(entry => entry.operation), ["TYPE_TEXT", "CLICK"]);
  assert.deepEqual(mock.actions, [["setValue", "3", "cats"], ["click", "1"]]);
  assert.equal(result.trace[0].source, "jev");
  assert.ok(result.post.observation.text.includes("Counter: 1"));
});

test("a single click cannot satisfy a two-step goal", async () => {
  const mock = mockCua();
  const result = await jevDesktopRun(REQUEST, { cua: mock.cua, ...injection(), decide: answer("CLICK", "click_target", "1") });
  assert.notEqual(result.status, "verified_done", "Counter: 1 alone is not proof that the field was set");
  assert.ok(result.trace.some(entry => entry.operation === "CLICK"));
});

test("a uniquely identified target needs no model call", async () => {
  const mock = mockCua();
  const result = await jevDesktopRun({
    ...REQUEST,
    deterministic: [
      { text: "fixture-input", operation: "TYPE_TEXT" },
      { text: "Increment", operation: "CLICK" },
    ],
  }, {
    cua: mock.cua,
    ...injection(),
    decide: async () => { throw new Error("Jev must not be called for a unique target"); },
  });
  assert.equal(result.status, "verified_done", JSON.stringify(result));
  assert.equal(result.model_calls, 0);
  assert.equal(result.steps, 2);
  assert.deepEqual(result.trace.map(entry => entry.source), ["deterministic_ax", "deterministic_ax"]);
});

test("DONE without visible evidence hands back to the LLM", async () => {
  const result = await jevDesktopRun(REQUEST, { cua: mockCua().cua, ...injection(), decide: answer("DONE") });
  assert.equal(result.status, "needs_llm");
  assert.equal(result.reason, "done_unverified");
  assert.equal(result.steps, 1, "the unverified DONE is recorded in the trace");
});

test("TYPE_TEXT without caller-supplied text executes nothing", async () => {
  const mock = mockCua();
  const result = await jevDesktopRun({ ...REQUEST, text: undefined }, { cua: mock.cua, ...injection(), decide: answer("TYPE_TEXT", "type_text_target", "3") });
  assert.equal(result.status, "needs_llm");
  assert.equal(result.reason, "text_required");
  assert.equal(result.steps, 0);
  assert.deepEqual(mock.actions, [], "Jev never generates open text and no action is replayed");
});

test("a query index outside the fresh AX observation is rejected before acting", async () => {
  const mock = mockCua();
  const queried = {
    async getApp() {
      const app = await mock.cua.getApp();
      return { ...app, query: async () => ({ truncated: false, matches: [{ index: 987654 }], stop_reason: "complete" }) };
    },
  };
  const result = await jevDesktopRun({ ...REQUEST, deterministic: [{ text: "Increment", operation: "CLICK" }] }, {
    cua: queried,
    ...injection(),
    decide: async () => { throw new Error("Jev must not be called for a unique target"); },
  });
  assert.equal(result.status, "needs_llm");
  assert.equal(result.reason, "unknown_target");
  assert.deepEqual(mock.actions, []);
});

test("the tool is env-gated and leaves the original tools intact", () => {
  assert.equal(jevEnabled({}), false);
  assert.equal(jevEnabled({ OCU_JEV: "1" }), true);
  assert.deepEqual(toolDefinitions({}).map(tool => tool.name), ["js", "js_reset"]);
  assert.deepEqual(toolDefinitions({ OCU_JEV: "1" }).map(tool => tool.name), ["js", "js_reset", "jev_desktop_run"]);
  assert.equal(jevToolDefinition().name, "jev_desktop_run");
});

const liveKey = process.env.TYPESAFE_API_KEY || process.env.JEV_KEY;
test("live Jev request is consumable", { skip: liveKey ? false : "set TYPESAFE_API_KEY or JEV_KEY" }, async () => {
  const body = buildQuestions(REQUEST, parseAXState(FIXTURE_AX), []);
  const response = await httpDecide(body);
  const decision = choose(body, response.answers, parseAXState(FIXTURE_AX));
  assert.ok(!decision.error, JSON.stringify(response).slice(0, 600));
  assert.ok(["CLICK", "TYPE_TEXT", "SCROLL_DOWN", "WAIT", "DONE"].includes(decision.operation));
});
