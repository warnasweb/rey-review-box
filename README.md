# ▣ rey-review-box

**A focused GitHub review workspace inside Claude Code.** Version 0.1.0.

Keep review requests, your pull requests, assignments, mentions and recent changes close to your prompt. Select work, collect a review draft, and decide when Claude should act.

```text
rey-review-box · Reviews 3 · My PRs 4 · Issues 2 · CI failing 1
[ Open workspace ]

[ To Review ] [ My PRs ] [ My Issues ] [ Activity ]
owner/payments #431 · Improve retry handling
alice · Changes requested · CI FAILURE · +241 −83 · 7 files
⚠ API  ⚠ Config
[ Open ] [ Review ] [ Summarize ] [ Hide ]
```

This is an illustrative layout, not a captured screenshot. Screenshot placeholders: terminal band and dashboard with redacted sample data.

## Requirements

- **Claude Code 2.1.294 or newer**, with Mods/function hooks available. 2.1.294 is the minimum supported and tested version for this project. Early-access APIs may change; later versions are not automatically guaranteed compatible.
- **Node.js 22+** on the PATH inherited by Claude Code.
- **GitHub CLI (`gh`)**, authenticated with permission to read the repositories you want to review.
- A Claude Code **terminal session**. The band and dashboard target the terminal surface; other surfaces are not supported in 0.1.0.

```sh
gh --version
gh auth login
gh auth status
claude --version
node --version
```

## Install

Inside Claude Code:

```text
/plugin marketplace add https://github.com/warnasweb/rey-review-box.git
/plugin install rey-review-box@rey-review-box
```

Restart Claude Code after installing. The repository includes its built worker, so marketplace installation requires no npm step. It has no production npm dependencies.

For a local checkout:

```sh
git clone https://github.com/warnasweb/rey-review-box.git
cd rey-review-box
npm ci
npm run build
claude --plugin-dir .
```

Then run `/rey-review-box`.

`npm ci` downloads the pinned upstream API type declarations for development. They are ignored by git and remain subject to Anthropic's terms. The plugin implementation and tests are original MIT-licensed code.

For GitHub Enterprise, authenticate and set the host **before starting Claude**:

```sh
gh auth login --hostname github.example.com
GH_HOST=github.example.com claude --plugin-dir .
```

All GitHub calls use that host. An older Enterprise GraphQL schema may lack a requested field; errors retain the last good data rather than showing a partial successful refresh.

## Workflow

- **To Review:** repository, title, author, dates, labels, size, commits, deterministic risk flags, optional AI summary, and Review / Open / Hide actions. Hide lasts until HEAD changes.
- **My PRs:** changes requested, failed CI, merge conflicts, new reviews/comments, waiting, approved, then drafts. Ties show the oldest first.
- **My Issues:** assigned issues plus mentioning issues and PRs, deduplicated; assignment takes precedence.
- **Activity:** review requests and re-requests, comments/reviews on your PRs, approvals, change requests, CI failure/recovery, conflicts, assignments and mentions detected between successful snapshots. Retains up to 100 events for 30 days.
- **Status band:** stays above the prompt, yields to surveys, shows nonzero counts and connection trouble. The host can collapse it.
- **Toasts:** new activity only, no replay of historical activity on session startup; deduplicated per session and spaced 4.5 seconds apart.

The pane has five items per page, Previous/Next controls and native scrolling. Use Tab/Enter or pointer controls. GitHub links use the host's supported Link element.

**Review** and **Ask Claude** queue drafts. Close the pane to append them to the current prompt, preserving existing text. Inspect the draft and press Enter yourself. Selecting Review never submits a GitHub review, publishes a comment or starts a model turn. Drafts include explicit untrusted-data boundaries, review criteria and severity/file/line requirements.

## Commands

| Command                                | Action                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/rey-review-box`                      | Open the dashboard                                                                                 |
| `/rey-review-box review`               | To Review                                                                                          |
| `/rey-review-box prs`                  | My PRs                                                                                             |
| `/rey-review-box issues`               | My Issues                                                                                          |
| `/rey-review-box activity`             | Recent activity                                                                                    |
| `/rey-review-box refresh`              | Force a shared GitHub refresh                                                                      |
| `/rey-review-box status`               | Host, account, last fetch and error state                                                          |
| `/rey-review-box config`               | Display settings and their file path                                                               |
| `/rey-review-box config <key> <value>` | Change one setting                                                                                 |
| `/rey-review-box clear-cache`          | Clear the current host/account/scope/language partition, including summary claims and hidden items |

## Configuration

Settings live in `~/.claude/plugins/data/rey-review-box/settings.json`. `CLAUDE_CONFIG_DIR` replaces `~/.claude` when set. Changes are read on the next poll, normally within 30 seconds.

```json
{
  "enabled": true,
  "refreshMinutes": 5,
  "language": "en",
  "scope": "",
  "githubUser": "",
  "showToasts": true,
  "enableAISummaries": true,
  "maxReviews": 100,
  "maxIssues": 100,
  "reviewPreferences": ""
}
```

Examples:

```text
/rey-review-box config scope org:my-company -repo:my-company/archive
/rey-review-box config refreshMinutes 10
/rey-review-box config showToasts false
/rey-review-box config reviewPreferences Focus on security, API compatibility and missing regression tests.
```

Refresh is clamped to 1–60 minutes; list limits to 1–100. Unknown file keys are ignored. `language` controls AI summaries; UI labels are English. `githubUser` is an optional account assertion, not a token setting: when it differs from the active `gh` account, fetching stops. Switch accounts with `gh auth switch` outside Claude and refresh. No tokens are read, printed or stored by the plugin.

Automatic review-style learning is **not included** in 0.1.0. The optional `reviewPreferences` setting supplies a transparent, user-authored alternative.

## Cache and AI summaries

Every 30 seconds a lightweight worker checks the shared disk cache. GitHub list data refreshes every five minutes by default; the active account is checked at most once a minute per host in normal operation. Force refresh also checks identity. Search scopes and languages have separate hashed partitions, as do hosts and accounts. Shared list refreshes use an atomic directory lock; competing sessions read the last committed snapshot. JSON writes use a temporary file and atomic rename. Failed refreshes retain good data and wait at least a minute before retrying.

A crashed owner is not silently evicted. `clear-cache` can recover a dead process's lock; it refuses to remove a live refresh lock. An incomplete lock without an owner requires two minutes before recovery. Do not share the cache directory across machines.

**Summarize** lazily requests one short, tool-free Haiku completion through `$.model.complete`. It sends the title, first 12,000 body characters, up to 80 file paths and line counts to your configured Claude provider. This uses your Claude allowance. Results are keyed by PR ID, **HEAD SHA**, and language within the account/host partition. Other sessions reuse the result; a shared claim prevents concurrent generation. Failed/incomplete attempts retry no sooner than 15 minutes, with a maximum of three attempts per key. No summaries are generated just by opening a session.

Risk flags inspect paths without model calls: Database, API, Security, Dependency, Infra and Config. They are heuristics, not a security audit. If files exceed the 80-file sample, the card says so.

## Limits and semantics

- Up to 100 review requests and own PRs; up to the configured limit each of assigned and mentioning results. Results are bounded rather than silently paginated indefinitely. A visible notice asks you to narrow scope when search counts exceed results.
- Request dates use the newest request event among the last 20 events, which may concern a different reviewer. They are shown as unavailable when absent. They are not a precise personal review SLA.
- Review state uses the last 10 reviews; latest conversation comment timestamps are used for comment activity. Inline review-thread replies without a new review are not separately fetched.
- “New review/comment” means later than the latest commit; it clears on the next commit. Activity is a snapshot change log, not a complete GitHub notification history. Events occurring entirely between polls can be missed.
- CI is the latest commit's aggregate check state. Missing checks show UNKNOWN. A recovery can include a transition from pending to successful.
- AI summaries are requested explicitly, not eagerly. Existing summaries are reused for unchanged HEADs; old HEAD summaries are pruned after a successful refresh.
- Uninstalling retains local caches. `clear-cache` preserves configuration and other partitions. To remove everything, delete this plugin's data folder after closing its sessions.

## Security and privacy

The hook module uses the documented `session.start`, `session.end`, `command.run`, `ui.close`, and `ui.render` events. Rendering uses `AbovePrompt` and `Pane`; there are no invented UI APIs or classic-hook shims.

The host starts a fixed, bundled Node worker by argument vector. The worker uses `execFile('gh', args)` without a shell. Search values travel as individual arguments; GitHub titles, bodies and branch names are never executed. Returned GitHub URLs are ignored: links are reconstructed from the validated host, repository and number. Terminal controls and bidi control characters are removed. Summary and review prompts explicitly identify GitHub text as untrusted; these boundaries reduce, but cannot guarantee immunity to, prompt injection.

`claude plugin validate` reports the host's `$.process.run` call; it cannot inventory every operation inside the Node worker. Review `src/worker.ts`, `src/github.ts` and `src/storage.ts` as well: the worker runs `gh api user` and `gh api graphql`, reads inherited `GH_HOST` / `CLAUDE_CONFIG_DIR`, and reads/writes only its own cache tree. It inherits normal `gh` authentication; no PAT configuration is required. There is no telemetry, webhook server or direct third-party network client at runtime. AI calls go through Claude Code.

Cached PR bodies, titles, file names, activity and summaries can contain private repository data. Files are created with mode 0600 and directories with 0700 where supported, but data is not encrypted at rest. The plugin never automatically writes to GitHub. A later user-submitted review prompt is handled by Claude under that session's permissions.

## Development

```sh
npm ci
npm run build
npm test
npm run typecheck
npm run validate       # claude plugin validate .
npm run test:plugin    # claude plugin test .
claude --plugin-dir .
```

Built `dist/` files are committed so marketplace installation works without dependencies. Rebuild after changing `src/`. CI checks that build output matches the committed files. Native plugin tests validate the actual loader and terminal element tree; unit and worker tests cover parsing, priorities, risks, TTL, locking, hiding, activity, summaries and configuration.

```text
.claude-plugin/  Plugin manifest and single-plugin marketplace
hooks/          Native event integration, terminal band and dashboard
src/domain.ts   Types, config, priorities, risks, activity and review prompts
src/github.ts   GitHub queries and response normalization
src/storage.ts  Atomic JSON writes and interprocess locking
src/worker.ts   Shared cache service and fixed action dispatch
 dist/          Committed worker build (no runtime npm dependencies)
tests/          Claude Code native test harness
unit/           Node unit and worker integration tests
scripts/        Pinned API type download for development
.github/        CI workflow
```

The API contract was checked against [Anthropic's official Mods documentation](https://github.com/anthropics/claude-code/tree/71cdddec623889d38af14b7a489670a03186f659/mods) and the 2.1.294 validator/test runner. Downloaded declarations are upstream development inputs and are not redistributed under this project's MIT license.

To publish your own fork, update the manifest author, marketplace owner and README URLs, commit the source and rebuilt worker, then publish the repository. Users add its URL with `/plugin marketplace add` and install `rey-review-box@rey-review-box`.

## Troubleshooting

- **No band:** use a terminal session, check `enabled`, expand the host's collapsed band, and ensure Mods are available on your Claude version.
- **Cannot load data:** check `node --version`, `gh auth status`, the inherited PATH, `GH_HOST`, `githubUser`, and cache permissions. On macOS ensure Node's architecture matches your machine.
- **Stale data:** check scope/rate limits, run `refresh`, then `status`. Failure preserves the last good snapshot. If a process crashed, `clear-cache` recovers its dead lock.
- **Summary absent:** enable AI summaries, press Summarize, and check your Claude account/model access. Retry after the claim cooldown; clearing the current partition resets claims.
- **Prompt unchanged:** drafts are appended after the pane closes. If no prompt is mounted, drafts remain in memory; reopen and close the pane when the prompt is available.
- **Type download blocked:** obtain the declarations at the pinned revision into `types/claude-code.d.ts`, or use `/plugin-types` from the supported Claude version. This is needed only for development, not marketplace use.

## License

MIT. See [LICENSE](LICENSE) and [CONTRIBUTING.md](CONTRIBUTING.md).
