import { empty, defaults, type Item } from "../src/domain";
import { describe, expect, mock, test, tier } from "claude-code/testing";
tier("user");
describe("register", () => {
  test("registers a command and reports an unconnected status without GitHub", async ($, on) => {
    mock.clock(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("command.register", ($, e) => ({ value: { command: e.name } }));
    await $.session.start({
      surface: "terminal",
      isInteractive: false,
      cwd: "/work",
    });
    const { text } = await $.command.run({
      command: "rey-review-box",
      args: "status",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 100 },
    });
    expect(text).toContain("rey-review-box");
    expect(text).toContain("not connected");
  });
  test("unknown subcommands show help without running a process", async ($, on) => {
    const { text } = await $.command.run({
      command: "rey-review-box",
      args: "nonsense",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 100 },
    });
    expect(text).toContain("clear-cache");
  });
  test("configuration calls use a fixed executable and JSON stdin", async ($, on) => {
    on("process.run", ($, e) => {
      expect(e.argv[0]).toBe("node");
      expect(e.argv.length).toBe(2);
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({
            config: { enabled: false },
            path: "/cache/settings.json",
          }),
          stderr: "",
        },
      };
    });
    on("ui.invalidate", () => ({ value: undefined }));
    const { text } = await $.command.run({
      command: "rey-review-box",
      args: "config enabled false",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 100 },
    });
    expect(text).toContain("false");
  });
  test("terminal band and drawer render and tabs respond", async ($, on) => {
    const band = await $.ui.mount({
      plugin: "rey-review-box",
      surface: "terminal",
      component: "AbovePrompt",
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 5,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 5 },
        view: {},
      },
    });
    expect(await band.find({ key: "open" })).toBeDefined();
    const pane = await $.ui.mount({
      plugin: "rey-review-box",
      surface: "terminal",
      component: "Pane",
      requestId: "rey-review-box",
      props: {
        title: "rey-review-box",
        isFocused: true,
        bodyColumns: 100,
        placement: "inline",
        scroll: { offset: 0, bodyRows: 25 },
        view: {},
      },
    });
    expect(await pane.find({ key: "review" })).toBeDefined();
    await pane.press({ key: "activity" });
    expect(
      await pane.find({ type: "Text", text: "No items here." }),
    ).toBeDefined();
    await pane.unmount();
    await band.unmount();
  });
  test("Review appends a draft only after closing; startup activity stays silent", async ($, on) => {
    mock.clock(on);
    const i: Item = {
      id: "P_demo",
      repo: "owner/repo",
      number: 7,
      title: "Example",
      body: "",
      url: "https://github.com/owner/repo/pull/7",
      author: "alice",
      created: "2026-01-01",
      updated: "2026-01-02",
      labels: [],
      kind: "pr",
      sha: "abc",
      files: ["migration.sql"],
      fileCount: 1,
      additions: 10,
      deletions: 2,
      commits: 1,
      draft: false,
      decision: "",
      ci: "SUCCESS",
      conflict: false,
      reviewAt: "",
      commentAt: "",
      requestedAt: "",
      committedAt: "2026-01-02",
      reason: "",
      truncatedFiles: false,
    };
    const snapshot = {
      ...empty(),
      fetchedAt: 100,
      reviews: [i],
      activity: [{ id: "old", item: "P_demo", text: "Old request", at: 50 }],
    };
    let filled = "";
    let notifications = 0;
    on("process.run", () => ({
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ snapshot, config: defaults }),
        stderr: "",
      },
    }));
    on("ui.invalidate", () => ({ value: undefined }));
    on("ui.toast", () => {
      notifications++;
      return { value: undefined };
    });
    on("ui.close", () => ({ value: undefined }));
    on("prompt.fill", ($, e) => {
      expect(e.mode).toBe("append");
      filled = e.text;
      return { isFilled: true, text: e.text, cursor: e.text.length };
    });
    await $.command.run({
      command: "rey-review-box",
      args: "refresh",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 100 },
    });
    expect(notifications).toBe(0);
    const pane = await $.ui.mount({
      plugin: "rey-review-box",
      surface: "terminal",
      component: "Pane",
      requestId: "rey-review-box",
      props: {
        title: "rey-review-box",
        isFocused: true,
        bodyColumns: 100,
        placement: "inline",
        scroll: { offset: 0, bodyRows: 25 },
        view: {},
      },
    });
    await pane.press({ key: "review-P_demo" });
    expect(filled).toBe("");
    await pane.press({ key: "close" });
    expect(filled).toContain("owner/repo#7");
    expect(filled).toContain("Do NOT publish");
    await $.command.run({
      command: "rey-review-box",
      args: "refresh",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 100 },
    });
    expect(notifications).toBe(0);
    snapshot.activity.unshift({
      id: "new",
      item: "P_demo",
      text: "New request",
      at: 150,
    });
    await $.command.run({
      command: "rey-review-box",
      args: "refresh",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 100 },
    });
    expect(notifications).toBe(1);
    await $.command.run({
      command: "rey-review-box",
      args: "refresh",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 100 },
    });
    expect(notifications).toBe(1);
    await pane.unmount();
  });
});
