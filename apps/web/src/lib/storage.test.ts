import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeRelDir, sanitizeRelPath } from "./storage";

test("sanitizeRelPath accepts normal vault paths", () => {
  assert.equal(sanitizeRelPath("vaults/id/index.json"), "vaults/id/index.json");
  assert.equal(sanitizeRelPath(" items/entry/1.json "), "items/entry/1.json");
});

test("sanitizeRelPath rejects ambiguous or escaping paths", () => {
  assert.equal(sanitizeRelPath(null), null);
  assert.equal(sanitizeRelPath(""), null);
  assert.equal(sanitizeRelPath("/index.json"), null);
  assert.equal(sanitizeRelPath("../index.json"), null);
  assert.equal(sanitizeRelPath("items/../index.json"), null);
  assert.equal(sanitizeRelPath("items//entry.json"), null);
  assert.equal(sanitizeRelPath("items/./entry.json"), null);
  assert.equal(sanitizeRelPath("items/\u0000/entry.json"), null);
});

test("sanitizeRelDir allows root directory only when requested", () => {
  assert.equal(sanitizeRelDir(""), "");
  assert.equal(sanitizeRelDir("vaults/id/items"), "vaults/id/items");
  assert.equal(sanitizeRelDir("../items"), null);
});
