import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clean, record } from "./domain.js";
const exec = promisify(execFile);
export async function gh(args, env = process.env) {
    const { stdout } = await exec("gh", args, {
        env,
        timeout: 60000,
        maxBuffer: 12 * 1024 * 1024,
        windowsHide: true,
    });
    return JSON.parse(stdout);
}
const common = `id number title body url createdAt updatedAt author { login } repository { nameWithOwner } labels(first:20) { nodes { name } }`;
const pr = `${common} headRefOid isDraft additions deletions changedFiles mergeable reviewDecision files(first:80) { nodes { path } pageInfo { hasNextPage } } commits(last:1) { totalCount nodes { commit { committedDate statusCheckRollup { state } } } } reviews(last:10) { nodes { submittedAt state author { login } } } comments(last:1) { nodes { createdAt author { login } } } timelineItems(last:20,itemTypes:[REVIEW_REQUESTED_EVENT]) { nodes { ... on ReviewRequestedEvent { createdAt } } }`;
export const query = `query($review:String!,$mine:String!,$assigned:String!,$mentioned:String!,$nr:Int!,$ni:Int!) { viewer { login } reviews:search(query:$review,type:ISSUE,first:$nr) { issueCount nodes { ... on PullRequest { ${pr} } } } prs:search(query:$mine,type:ISSUE,first:100) { issueCount nodes { ... on PullRequest { ${pr} } } } assigned:search(query:$assigned,type:ISSUE,first:$ni) { issueCount nodes { ... on Issue { ${common} } } } mentioned:search(query:$mentioned,type:ISSUE,first:$ni) { issueCount nodes { ... on Issue { ${common} } ... on PullRequest { ${common} headRefOid } } } }`;
export function parseItem(value, host, reason = "") {
    const n = record(value);
    const repo = clean(n.repository?.nameWithOwner);
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) ||
        !Number.isSafeInteger(n.number) ||
        n.number < 1 ||
        typeof n.id !== "string")
        return null;
    const isPR = typeof n.headRefOid === "string";
    const nodes = (v) => Array.isArray(record(v).nodes) ? record(v).nodes.filter(Boolean) : [];
    const commit = nodes(n.commits)[0]?.commit;
    const review = nodes(n.reviews)
        .filter((x) => x.state !== "DISMISSED")
        .map((x) => clean(x.submittedAt))
        .sort()
        .at(-1) ?? "";
    return {
        id: clean(n.id),
        repo,
        number: n.number,
        title: clean(n.title),
        body: clean(n.body, 12000),
        url: `https://${host}/${repo}/${isPR ? "pull" : "issues"}/${n.number}`,
        author: clean(n.author?.login) || "deleted account",
        created: clean(n.createdAt),
        updated: clean(n.updatedAt),
        labels: nodes(n.labels).map((x) => clean(x.name, 80)),
        kind: isPR ? "pr" : "issue",
        sha: clean(n.headRefOid, 64),
        files: nodes(n.files).map((x) => clean(x.path, 500)),
        fileCount: Number(n.changedFiles) || 0,
        additions: Number(n.additions) || 0,
        deletions: Number(n.deletions) || 0,
        commits: Number(n.commits?.totalCount) || 0,
        draft: n.isDraft === true,
        decision: clean(n.reviewDecision),
        ci: clean(commit?.statusCheckRollup?.state) || "UNKNOWN",
        conflict: n.mergeable === "CONFLICTING",
        reviewAt: review,
        commentAt: clean(nodes(n.comments)[0]?.createdAt),
        requestedAt: clean(nodes(n.timelineItems).at(-1)?.createdAt),
        committedAt: clean(commit?.committedDate),
        reason,
        truncatedFiles: n.files?.pageInfo?.hasNextPage === true,
    };
}
export async function fetchGitHub(c, host, user) {
    const suffix = c.scope ? ` ${c.scope}` : "";
    const data = await gh([
        "api",
        "graphql",
        "--hostname",
        host,
        "-f",
        `query=${query}`,
        "-f",
        `review=is:pr is:open review-requested:${user}${suffix}`,
        "-f",
        `mine=is:pr is:open author:${user}${suffix}`,
        "-f",
        `assigned=is:issue is:open assignee:${user}${suffix}`,
        "-f",
        `mentioned=is:open mentions:${user}${suffix}`,
        "-F",
        `nr=${c.maxReviews}`,
        "-F",
        `ni=${c.maxIssues}`,
    ]);
    if (data.errors?.length || !data.data?.viewer?.login)
        throw new Error("GitHub query failed; check host, authentication, scope and rate limits.");
    const d = data.data;
    const parse = (key, reason = "") => (Array.isArray(d[key]?.nodes) ? d[key].nodes : [])
        .map((n) => parseItem(n, host, reason))
        .filter((n) => !!n);
    return {
        reviews: parse("reviews"),
        prs: parse("prs"),
        issues: [
            ...new Map([
                ...parse("mentioned", "Mentioned"),
                ...parse("assigned", "Assigned"),
            ].map((i) => [i.id, i])).values(),
        ],
        truncated: ["reviews", "prs", "assigned", "mentioned"].some((k) => d[k].issueCount > d[k].nodes.length),
    };
}
