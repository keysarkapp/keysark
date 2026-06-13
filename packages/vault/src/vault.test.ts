import assert from "node:assert/strict";
import test from "node:test";
import { Vault, VaultIntegrityError, makeCache, memoryKv } from "./index";
import type { StorageTransport } from "./types";

async function testKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

test("load throws VaultIntegrityError for a corrupt remote index", async () => {
  const transport: StorageTransport = {
    async list() {
      return new Map([["index.json", { id: "idx", size: 3 }]]);
    },
    async download() {
      return new TextEncoder().encode("bad");
    },
    async upload() {},
    async delete() {},
  };
  const vault = new Vault(await testKey(), { dir: "" }, transport, makeCache(memoryKv(), "corrupt"));

  await assert.rejects(() => vault.load(), VaultIntegrityError);
});

test("remove commits index before deleting version files", async () => {
  const ops: string[] = [];
  const transport: StorageTransport = {
    async list(dir) {
      ops.push(`list:${dir}`);
      return new Map([
        ["1.json", { id: "json", size: 1 }],
        ["1.bin", { id: "bin", size: 1 }],
      ]);
    },
    async download() {
      throw new Error("not used");
    },
    async upload(path) {
      ops.push(`upload:${path}`);
    },
    async delete(path) {
      ops.push(`delete:${path}`);
    },
  };
  const vault = new Vault(await testKey(), { dir: "" }, transport, makeCache(memoryKv(), "remove"));
  await vault.save({ id: "entry", title: "title", content: "secret" });

  ops.length = 0;
  const result = await vault.remove("entry");

  assert.equal(result.synced, true);
  assert.deepEqual(ops, [
    "upload:index.json",
    "list:items/entry",
    "delete:items/entry/1.json",
    "delete:items/entry/1.bin",
  ]);
});

test("remove does not delete versions when index commit fails", async () => {
  const ops: string[] = [];
  const transport: StorageTransport = {
    async list(dir) {
      ops.push(`list:${dir}`);
      return new Map([["1.json", { id: "json", size: 1 }]]);
    },
    async download() {
      throw new Error("not used");
    },
    async upload(path) {
      ops.push(`upload:${path}`);
      if (path === "index.json") throw new Error("index unavailable");
    },
    async delete(path) {
      ops.push(`delete:${path}`);
    },
  };
  const vault = new Vault(await testKey(), { dir: "" }, transport, makeCache(memoryKv(), "remove-fail"));
  await vault.save({ id: "entry", title: "title", content: "secret" }).catch(() => {});

  ops.length = 0;
  const result = await vault.remove("entry");

  assert.equal(result.synced, false);
  assert.deepEqual(ops, ["upload:index.json"]);
});
