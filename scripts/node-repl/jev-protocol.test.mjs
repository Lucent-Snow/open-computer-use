import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkVector } from "./jev-protocol-selfcheck.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = path.join(HERE, "..", "tests", "fixtures", "jev-protocol-vectors.json");

// The fixture is a verbatim copy of the canonical protocol vectors. Keeping a
// copy in this repository means `make test` / scripts/ci.sh can prove the AX
// implementation still honours the shared contract without BrowserSkill.
const vectors = JSON.parse(readFileSync(VECTORS, "utf8"));

test("Jev delegate protocol v0.1 vectors are present", () => {
  assert.ok(vectors.length >= 7, "expected at least 7 protocol vectors");
  assert.deepEqual(
    [...new Set(vectors.map(vector => vector.id))].length,
    vectors.length,
    "vector ids must be unique",
  );
});

for (const vector of vectors) {
  test(`protocol vector ${vector.id}`, () => checkVector(vector));
}
