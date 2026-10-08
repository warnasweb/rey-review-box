import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomic,
  Busy,
  readJSON,
  recoverDeadLock,
  withLock,
} from "../src/storage.js";
test("simultaneous sessions elect only one cache writer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rey-test-"));
  try {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const first = withLock(dir, async () => {
      entered();
      await held;
    });
    await ready;
    await assert.rejects(
      withLock(dir, async () => assert.fail("second writer entered")),
      Busy,
    );
    await assert.rejects(recoverDeadLock(dir), Busy);
    release();
    await first;
    await withLock(dir, async () => {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("lock releases after exceptions; writes remain valid JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rey-test-"));
  try {
    await assert.rejects(
      withLock(dir, async () => {
        throw new Error("fail");
      }),
    );
    await withLock(dir, () => atomic(join(dir, "state.json"), { value: 42 }));
    assert.deepEqual(await readJSON(join(dir, "state.json"), {}), {
      value: 42,
    });
    assert.deepEqual(await readJSON(join(dir, "missing"), { fallback: true }), {
      fallback: true,
    });
    assert.equal(
      JSON.parse(await readFile(join(dir, "state.json"), "utf8")).value,
      42,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
