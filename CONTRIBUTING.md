# Contributing

Use Node.js 22+ and the Claude Code version pinned in package.json. Run `npm ci`, then `npm run build`, `npm test`, `npm run typecheck`, `npm run validate` and `npm run test:plugin`.

Put host integration tests in `tests/*.test.ts` and Node tests in `unit/*.spec.ts`. The native runner discovers `.test.ts` files throughout the project, so reserve that suffix for its harness. Never call live GitHub or a paid model in automated tests.

Source changes under `src/` must include rebuilt `dist/` output. Do not commit downloaded API types, caches, private GitHub data, tokens or machine-specific paths. Use fixtures with invented identities and repository names.

Validate every new hook or UI element against current official declarations and the actual plugin loader. Keep `$` calls visible to the loader's static scanner. Pass GitHub search data as separate process arguments; never introduce shell interpolation. Retain explicit untrusted-data boundaries in model prompts. Do not add GitHub writes to dashboard buttons without a separate, explicit user action.

PRs should explain the behavior change, relevant limitations and validation performed. Keep requests scoped and include a regression test for behavior bugs. Contributions are under the MIT license.
