#!/usr/bin/env node

// Self-check for the language-independent Jev delegate protocol v0.1.
// `protocol/vectors.json` in the integration workspace is canonical; a copy
// lives at scripts/tests/fixtures/jev-protocol-vectors.json so this repository
// can enforce the contract in its own CI without the other repository present.

import assert from "node:assert/strict";
import {
  buildQuestions,
  choose,
  parseAXState,
  verified,
} from "./jev-desktop-run.mjs";

/** Reproduce the real System One answer shape: one probability per offered id
 *  on every head. A vector can deliberately corrupt one head. */
export function makeAnswers(body, vector) {
  const answers = {};
  const operation = vector.decision.operation;
  const targetHead = `${operation.toLowerCase()}_target`;
  for (const [head, question] of Object.entries(body.questions)) {
    const ids = Object.keys(question.criteria);
    const wanted = vector.decision.target ?? ids[0];
    let picked = head === "operation" ? operation : head === targetHead ? wanted : ids[0];
    if (vector.answer_mode === "stale_target" && head === targetHead) picked = ids[0];
    const probabilities = {};
    const others = ids.length - 1;
    for (const id of ids) probabilities[id] = id === picked ? 1 - 0.01 * others : 0.01;
    if (vector.answer_mode === "partial" && head === "operation") {
      const drop = ids.find(id => id !== picked);
      if (drop) delete probabilities[drop];
    }
    const answer = { choice: picked, confidence: 0.9, probabilities };
    if (vector.answer_mode === "stale_target" && head === targetHead) {
      answer.choice = vector.decision.target;
    }
    answers[head] = answer;
  }
  return { answers, model: "jev-test", usage: { input_tokens: 10 } };
}

/** `choose` throws on a malformed head and returns `{ error }` on a stale
 *  target that is offered but absent from the current observation. Both mean
 *  the implementation refused to act, which is what the vectors assert. */
function decisionError(decision) {
  if (decision.error?.startsWith("no candidate")) return "unknown_target";
  if (decision.error) return "invalid_choice";
  return null;
}

/** Check one decision moment against this (AX-only, JavaScript) implementation. */
export function checkVector(vector) {
  const id = vector.id;
  const observation = parseAXState(vector.ocu.ax);
  // The protocol fixes the decision contract, not each backend's AX parser.
  // Use the vector's candidate set so both implementations offer identical ids.
  observation.candidates = vector.candidates.map(candidate => ({
    ...candidate,
    reference: candidate.index,
    identifier: `ax-${candidate.index}`,
  }));

  const body = buildQuestions(vector.request, observation, []);
  const heads = Object.keys(body.questions).sort();
  assert.deepEqual(heads, [...vector.expect.heads].sort(), `${id}: heads`);

  const response = makeAnswers(body, vector);
  let error = null;
  let decision = null;
  try {
    decision = choose(body, response.answers, observation);
    error = decisionError(decision);
  } catch {
    error = "invalid_choice";
  }
  assert.equal(error, vector.expect.decision_error, `${id}: decision_error`);
  if (!error) {
    assert.equal(decision.operation, vector.expect.operation, `${id}: operation`);
    assert.equal(decision.target, vector.expect.target, `${id}: target`);
  }

  const previousEvidence = vector.previous_same_as_current
    ? observation.evidence
    : "no evidence yet";
  const accepted = verified(
    vector.request.expected,
    observation.evidence,
    previousEvidence,
    [{ step: 0 }],
    [],
    observation.lines,
  );
  assert.equal(accepted, vector.expect.verified, `${id}: verified`);
}
