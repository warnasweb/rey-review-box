import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

// A fake gh executable verifies the worker end-to-end without credentials or network.
test("worker shares cache, claims summaries once, hides by SHA and clears data", async () => {
  const root = await mkdtemp(join(tmpdir(), "rey-worker-"));
  try {
    const bin = join(root, "bin");
    await mkdir(bin);
    const fixture = {
      id: "P_test",
      number: 1,
      title: "Example",
      body: "Untrusted text",
      headRefOid: "a1",
      repository: { nameWithOwner: "owner/repo" },
      author: { login: "alice" },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    };
    const search = { issueCount: 1, nodes: [fixture] };
    const reply = {
      data: {
        viewer: { login: "tester" },
        reviews: search,
        prs: { issueCount: 0, nodes: [] },
        assigned: { issueCount: 0, nodes: [] },
        mentioned: { issueCount: 0, nodes: [] },
      },
    };
    await writeFile(
      join(bin, "gh"),
      `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.includes('graphql')?${JSON.stringify(reply)}:{login:'tester'}));`,
      { mode: 0o700 },
    );
    const call = (request: unknown) =>
      new Promise<any>((resolvePromise, reject) => {
        const child = spawn(process.execPath, [resolve("dist/worker.js")], {
          env: {
            ...process.env,
            GH_HOST: "github.com",
            CLAUDE_CONFIG_DIR: root,
            PATH: `${bin}:${process.env.PATH}`,
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "";
        let err = "";
        child.stdout.on("data", (b) => (output += b));
        child.stderr.on("data", (b) => (err += b));
        child.on("error", reject);
        child.on("close", (code) => {
          if (code) reject(new Error(err || output));
          else resolvePromise(JSON.parse(output));
        });
        child.stdin.end(JSON.stringify(request));
      });
    const first = await call({ action: "refresh" });
    assert.equal(first.snapshot.reviews.length, 1);
    assert.equal(first.snapshot.activity.length, 0);
    const cached = await call({ action: "poll" });
    assert.equal(cached.snapshot.fetchedAt, first.snapshot.fetchedAt);
    const args = { id: "P_test", sha: "a1" };
    assert.equal(
      (await call({ action: "summary-claim", ...args })).snapshot.claimed,
      true,
    );
    assert.equal(
      (await call({ action: "summary-claim", ...args })).snapshot.claimed,
      undefined,
    );
    const saved = await call({
      action: "summary-save",
      ...args,
      text: "A concise summary",
    });
    assert.equal(saved.snapshot.summaries["P_test:a1:en"], "A concise summary");
    assert.equal(
      (await call({ action: "hide", id: "P_test" })).snapshot.hidden.P_test,
      "a1",
    );
    const cleared = await call({ action: "clear-cache" });
    assert.equal(cleared.snapshot.fetchedAt, 0);
    assert.deepEqual(cleared.snapshot.summaries, {});
    await call({ action: "refresh" });
    assert.equal(
      (await call({ action: "summary-claim", ...args })).snapshot.claimed,
      true,
    );
    await call({ action: "config", patch: { enabled: false } });
    assert.equal((await call({ action: "poll" })).config.enabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
