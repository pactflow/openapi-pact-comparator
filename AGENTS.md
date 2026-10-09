# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Overview

`@pactflow/openapi-pact-comparator` (CLI: `opc`) compares OpenAPI (v2/v3) or
AsyncAPI documents against Pact contracts and yields compatibility results. It
is a rewrite of swagger-mock-validator focused on speed: AJV schemas are
compiled once and reused across pacts, routes are matched with a find-my-way
radix tree, and work is split into async generators to keep the event loop free.
Node >=22, ESM, TypeScript.

## Commands

```
npm ci                                  # install (`prepare` runs patch-package + build)
npm test                                # vitest (watch mode); `npx vitest run` for one-shot
npx vitest run src/compare/asyncapi/matchMessages.test.ts   # single file
npx vitest run -t "test name"           # single test by name
npm run lint                            # eslint, max-warnings=0 (lint:fix to fix)
npm run prettier                        # check formatting (prettier:fix to fix)
npm run typecheck
npm run knip                            # unused exports/dependencies
npm run build                           # rollup -> dist/ (index.{cjs,mjs}, cli.{cjs,mjs})
node dist/cli.mjs --oas spec.yaml pact.json   # run the CLI
```

CI runs knip, lint, prettier, typecheck and test on Node 22 and 24. PRs need a
changeset (`npm run changeset:add`).

The CLI outputs ND-JSON, one line per Pact file; its exit code is the number of
Pact files with errors.

## Architecture

- `src/compare/index.ts` — `Comparator` is the public entry (exported from
  `src/index.ts`). The constructor takes `{ oas?, asyncapi? }` and builds two
  AJV instances: one with `coerceTypes` (path/query/header strings) and one
  without (bodies). `compare(pact)` is an async generator yielding `Result`s
  (`src/results`). The router is built lazily on the first `compare()`.
- `src/documents/` — parse/normalise Pact, OAS and AsyncAPI. Pact interactions
  are tagged by `_kind` (`http` | `async` | `sync` | `skip`) and dispatched in
  `Comparator.compare`; interactions of a kind whose spec wasn't supplied are
  skipped (or reported as errors for HTTP with no OAS).
- `src/compare/oas/` — HTTP flow: route match via find-my-way (`setup.ts`), then
  path -> security -> request header/query/body -> response header/body, one
  generator per file. A content-type incompatibility short-circuits the body
  comparison for that side.
- `src/compare/asyncapi/` — message and sync-message comparison (message
  matching, headers, payload).
- `src/transform/` — schema transforms applied before AJV (`flattenAllOf`,
  `minimumSchema`, `responseSchema`). `src/utils/schema.ts` dereferences without
  inlining so circular refs work and unused refs are pruned.
- `src/utils/config.ts` + `quirks.ts` — "quirks" for swagger-mock-validator
  compatibility, enabled by the `QUIRKS` env var or `x-opc-config-<name>` keys
  in the OAS `info` section.
- `src/cli.ts` + `src/cli/runner.ts` — commander-based CLI wrapper.
- Internal imports use the `#compare/*`, `#documents/*`, `#results/*`,
  `#transform/*`, `#utils/*` aliases (package.json `imports`) rather than deep
  relative paths; imports are sorted by eslint `simple-import-sort`.
- `patches/` — AJV is patched locally via patch-package (whitespace coercion,
  discriminator mapping) because upstream is effectively abandoned. Re-run
  `npm run patch-package` after installing with `--ignore-scripts`, and
  regenerate the patch if AJV is upgraded.

## Testing

- Unit tests are colocated as `*.test.ts` next to the source.
- Integration tests are fixture-driven: `src/__tests__/index.test.ts` iterates
  `src/__tests__/fixtures/<group>/<case>/`, each containing `oas.yaml` and/or
  `asyncapi.yaml`, `pact.json`, and the expected `results.json`. Add a new case
  by adding a directory.
