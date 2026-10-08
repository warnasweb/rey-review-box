import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { atomic, Busy, readJSON, recoverDeadLock, withLock, } from "./storage.js";
import { changes, clean, configOf, empty, fresh, priority, summaryKey, } from "./domain.js";
import { fetchGitHub, gh } from "./github.js";
async function main() {
    let stdin = "";
    for await (const chunk of process.stdin) {
        stdin += chunk;
        if (stdin.length > 100000)
            throw new Error("Request too large");
    }
    const request = JSON.parse(stdin || "{}");
    const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "plugins", "data", "rey-review-box");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const configPath = join(root, "settings.json");
    const c = configOf(await readJSON(configPath, {}));
    if (request.action === "config") {
        if (request.patch)
            await atomic(configPath, configOf({ ...c, ...request.patch }));
        return {
            config: configOf(await readJSON(configPath, c)),
            path: configPath,
        };
    }
    const host = (process.env.GH_HOST || "github.com").toLowerCase();
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))
        throw new Error("GH_HOST must be a hostname.");
    if (!c.enabled)
        return { config: c, snapshot: empty() };
    // Cache the authenticated identity briefly, without reading or storing credentials.
    const identityPath = join(root, `identity-${createHash("sha256").update(host).digest("hex").slice(0, 24)}.json`);
    let identity = await readJSON(identityPath, { login: "", at: 0 });
    if (!fresh(identity.at, Date.now(), 1) || request.action === "refresh") {
        const viewer = await gh(["api", "user", "--hostname", host]);
        if (!/^[\w-]+$/.test(viewer.login))
            throw new Error("GitHub returned an invalid identity.");
        identity = { login: viewer.login, at: Date.now() };
        await atomic(identityPath, identity);
    }
    if (c.githubUser && c.githubUser !== identity.login)
        throw new Error("Active gh account differs from githubUser. Use gh auth switch outside Claude Code.");
    const key = createHash("sha256")
        .update(JSON.stringify([
        host,
        identity.login,
        c.scope,
        c.language,
        c.maxReviews,
        c.maxIssues,
    ]))
        .digest("hex")
        .slice(0, 32);
    const dir = join(root, key);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "snapshot.json");
    const load = async () => {
        const s = await readJSON(path, empty());
        return s.version === 1 &&
            Array.isArray(s.reviews) &&
            Array.isArray(s.prs) &&
            Array.isArray(s.issues)
            ? s
            : empty();
    };
    if (request.action === "clear-cache")
        await recoverDeadLock(dir);
    try {
        const snapshot = await withLock(dir, async () => {
            let s = await load();
            s.host = host;
            s.user = identity.login;
            if (request.action === "clear-cache") {
                for (const name of await readdir(dir))
                    if (/^summary-[a-f0-9]+\.json$/.test(name) || name === "retry.json")
                        await rm(join(dir, name), { force: true });
                s = { ...empty(), host, user: identity.login };
                await atomic(path, s);
                return s;
            }
            if (request.action === "hide") {
                const item = s.reviews.find((i) => i.id === request.id);
                if (item)
                    s.hidden[item.id] = item.sha;
            }
            if (request.action === "summary-save") {
                const i = s.reviews.find((i) => i.id === request.id && i.sha === request.sha);
                if (i)
                    s.summaries[summaryKey(i, c.language)] = clean(request.text, 700);
            }
            if (request.action === "summary-claim") {
                const i = s.reviews.find((i) => i.id === request.id && i.sha === request.sha);
                if (!i || s.summaries[summaryKey(i, c.language)])
                    return s;
                const claimPath = join(dir, `summary-${createHash("sha256").update(summaryKey(i, c.language)).digest("hex")}.json`);
                const claim = await readJSON(claimPath, { at: 0, attempts: 0 });
                if (claim.attempts >= 3 || fresh(claim.at, Date.now(), 15))
                    return s;
                await atomic(claimPath, {
                    at: Date.now(),
                    attempts: claim.attempts + 1,
                });
                return { ...s, claimed: true };
            }
            if ((request.action === "refresh" || request.action === "poll") &&
                (request.action === "refresh" ||
                    !fresh(s.fetchedAt, Date.now(), c.refreshMinutes))) {
                const retry = await readJSON(join(dir, "retry.json"), { at: 0 });
                if (request.action === "poll" && fresh(retry.at, Date.now(), 1))
                    return s;
                try {
                    const lists = await fetchGitHub(c, host, identity.login);
                    const next = { ...s, ...lists, fetchedAt: Date.now() };
                    delete next.error;
                    next.prs.sort((a, b) => priority(a) - priority(b) || a.created.localeCompare(b.created));
                    next.activity = [...changes(s, next, Date.now()), ...s.activity]
                        .filter((e, index, all) => e.at > Date.now() - 30 * 86400000 &&
                        all.findIndex((x) => x.id === e.id) === index)
                        .slice(0, 100);
                    const keys = new Set(next.reviews.map((i) => summaryKey(i, c.language)));
                    next.summaries = Object.fromEntries(Object.entries(next.summaries).filter(([k]) => keys.has(k)));
                    next.hidden = Object.fromEntries(Object.entries(next.hidden).filter(([id, sha]) => next.reviews.some((i) => i.id === id && i.sha === sha)));
                    s = next;
                }
                catch {
                    s.error =
                        "GitHub refresh failed. Check gh auth status, GH_HOST, scope and API rate limits. Last good data retained.";
                    await atomic(join(dir, "retry.json"), { at: Date.now() });
                }
            }
            await atomic(path, s);
            return s;
        });
        return { config: c, snapshot };
    }
    catch (e) {
        if (e instanceof Busy)
            return {
                config: c,
                snapshot: await load(),
                busy: true,
                message: e.message,
            };
        throw e;
    }
}
main()
    .then((r) => process.stdout.write(JSON.stringify(r)))
    .catch(() => {
    process.stdout.write(JSON.stringify({
        error: "rey-review-box could not load data. Check Node.js 22+, gh authentication, GH_HOST, account configuration and cache permissions.",
    }));
    process.exitCode = 1;
});
