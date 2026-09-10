# GraphQL Bi-Directional Contract Testing — Design

Status: draft
Date: 2026-09-10
Companion document: [2026-09-10-graphql-bdct-requirements.md](./2026-09-10-graphql-bdct-requirements.md)

The requirements document defines what compatibility means. This document
defines how the comparator implements it: interfaces, modules, data flow, and
the risks worth knowing about before any code is written.

## 1. Background: what a GraphQL Pact actually looks like

The design is shaped by the concrete output of
[pact-graphql-plugin](https://github.com/mefellows/pact-graphql-plugin). A
GraphQL interaction is **not** a new interaction type — it is an ordinary V4
`Synchronous/HTTP` interaction with a plugin configuration attached:

```jsonc
{
  "type": "Synchronous/HTTP",
  "request": {
    "method": "POST", "path": "/graphql",
    "body": { "contentType": "application/graphql", "content": {
      "operationName": "GetProduct",
      "query": "query GetProduct($id: ID!) { product(id: $id) { id name status } }",
      "variables": { "id": "10" } } }
  },
  "response": {
    "body": { "contentType": "application/json",
              "content": { "data": { "product": { "id": "10", "name": "…", "status": "ACTIVE" } } } },
    "matchingRules": { "body": { "$.data.product.status": {
      "matchers": [{ "match": "regex", "regex": "^(ACTIVE|ARCHIVED|DRAFT|OUT_OF_STOCK)$" }] } } },
    "status": 200
  },
  "pluginConfiguration": { "graphql": {
    "query_document": "…", "operation_name": "GetProduct", "variables_json": "{\"id\":\"10\"}",
    "query_matching": "semantic", "transport": "json_body",
    "inline_schema": { "base64_sdl": "<provider SDL, base64>" },
    "schema_ref": { "hash": "fa7e57bd…", "encoding": "utf-8" }
  }}
}
```

Three consequences drive the design:

1. The operation is available **both** in the request body and, redundantly, in
   the plugin configuration. A comparator keyed off the body therefore works
   for plugin and non-plugin consumers alike, with the plugin configuration as
   a higher-fidelity source when present.
2. GraphQL interactions are HTTP-shaped, so they cannot be routed by
   `interaction.type` the way AsyncAPI messages are. Classification must
   inspect the interaction's content.
3. The embedded SDL is a snapshot of the provider's schema, not a
   consumer-authored subset — which is why §6 of the requirements confines it
   to diagnostics.

Subscription interactions are `Asynchronous/Messages` whose
`contents.content` is `{ subscription, variables, data }`, with the operation
document again in `pluginConfiguration.graphql.query_document`.

## 2. Key insight: the subset rule is already implemented, twice

The requirements' two directions each map onto machinery that already exists.

**The request rule is GraphQL's own validation.** Rules R1–R9 are the
specification's validation rules verbatim, which means `graphql.validate(schema,
document)` implements them — including precise `line:column` locations for
error reporting. Variables need one extra pass, since `validate` inspects the
document but never sees runtime values.

**The response rule is a projection plus this repo's existing transform.**
Because a GraphQL response mirrors its selection set, the expected shape can be
*derived* exactly rather than described. That derived shape is plain JSON
Schema, so the existing AJV pipeline compares it, and `stripRequired` from
`transform/responseSchema.ts` — written for the identical OpenAPI rule that a
consumer may omit fields it does not care about — supplies P7 and P8 unchanged.

The novel code is therefore confined to one function: the projection. Everything
else is wiring.

## 3. Public interface

```ts
export interface ComparatorOptions {
  oas?: OpenAPIV2.Document | OpenAPIV3.Document;
  asyncapi?: AsyncAPIDocument;
  graphql?: string;              // raw SDL text
}
```

SDL text, not a parsed `GraphQLSchema`, so that consumers of this library do not
inherit the `graphql` dependency in their own type positions, and not
introspection JSON, so there is a single input path to test. Users holding
introspection JSON convert before calling.

The CLI gains `--graphql <path|url>`. `Runner.readAndParse()` currently
JSON/YAML-parses everything it reads and needs a raw-text sibling for SDL.

The constructor validates eagerly — `buildSchema` then `validateSchema` — and
throws a `ParserError`, mirroring `documents/asyncapi.ts`. The built schema and
every compiled AJV validator are memoised on the `Comparator` instance so they
are reused across interactions and across pacts, consistent with the repo's
schema-reuse performance story.

## 4. Module layout

```
src/documents/graphql.ts          parse/validate SDL; project selection sets; hash SDL
src/compare/graphql/index.ts      orchestration for HTTP interactions
src/compare/graphql/requestOperation.ts    R1–R9
src/compare/graphql/responseBody.ts        P1–P8, U1–U4
src/compare/graphql/subscriptionMessage.ts message-shaped equivalent
src/compare/graphql/schemaProvenance.ts    S1–S3
```

This mirrors the existing `compare/oas/` and `compare/asyncapi/` split: one file
per comparison concern, each independently testable, none depending on another's
internals.

## 5. `documents/graphql.ts` — the projection

`projectSelectionSet(schema, document, operationName)` walks the selection set
from the operation's root type and returns a JSON Schema.

| GraphQL | JSON Schema |
|---|---|
| field with alias | property keyed by `alias ?? name` |
| `String` / `Int` / `Float` / `Boolean` | `{type:"string"｜"integer"｜"number"｜"boolean"}` |
| `ID` | `{type:["string","integer"]}` |
| enum | `{enum:[…values]}` |
| custom scalar | `true`, plus a `response.graphql.scalar.unvalidatable` warning |
| object / interface | `{type:"object", properties, required, additionalProperties:false}` |
| `T!` | not nullable |
| `T` | `type: [x, "null"]` |
| `[T]` | `{type:"array", items:…}` |
| interface or union with fragments | `anyOf` over possible types, discriminated by `__typename` where selected |
| `__typename` | `{enum:[…possible type names]}` |
| `@skip` / `@include` | the field becomes optional — the outcome is unknowable at comparison time |

The whole is wrapped in the envelope
`{type:"object", properties:{data:<projection｜null>, errors:true, extensions:true}, additionalProperties:false}`,
which is P6.

`additionalProperties:false` at every object level is what enforces P1 —
catching both a field the consumer never selected and a field that does not
exist on the type. It must be emitted by the projection itself rather than
applied afterwards by `transformReceivedSchema`, because that helper
deliberately skips `additionalProperties` on `anyOf` / `oneOf` nodes and the
abstract-type branches are exactly that. Only `stripRequired` is reused, which
means exporting it from `transform/responseSchema.ts`.

Fragment cycles cannot reach the projection because validation runs first, but
the walker still guards against them so a future caller cannot hang it.

## 6. `documents/pact.ts` — classification

Two kinds join the discriminated union: `graphql-http` and `graphql-message`.
`RawInteraction` grows a `pluginConfiguration` field.

Classification runs **after** the existing typebox/AJV interaction validation.
GraphQL HTTP interactions are HTTP-shaped and already satisfy `HttpMessage`, so
the existing schemas barely move; a GraphQL interaction is simply reclassified
out of `http` before it reaches the comparator.

The detection conditions are §4 of the requirements. The operation, its name,
and its variables are read from `pluginConfiguration.graphql` where present and
from the request body otherwise; disagreement between the two produces a
`request.graphql.inconsistent` warning naming the source that was used.

## 7. `Comparator.compare()` — routing

The switch on `interaction._kind` gains two cases. Each kind names the provider
contract it needs — `graphql-http` and `graphql-message` need `graphql`, `http`
needs `oas`, `async` and `sync` need `asyncapi` — and an interaction whose
contract was not supplied is skipped.

This is what makes mixed REST + GraphQL pacts work with no special casing: a
gateway pact gets its GraphQL interactions checked against the SDL and its REST
interactions against the OpenAPI document, from the same run.

Skipping is silent, matching the existing `break` for the oas/asyncapi
combination. See §5 of the requirements for why this known sharp edge is being
preserved rather than fixed here.

## 8. Comparison modules

**`requestOperation.ts`** parses, then validates against the schema. Each
`GraphQLError` becomes one `Result`, mapped to a specific code by validation
rule where the rule is identifiable and to a catch-all otherwise. The GraphQL
`line:column` goes in the message, `[root].interactions[i].request.body.content.query`
in `mockDetails.location`, and `[root].<Type>.<field>` in
`specDetails.location` where derivable. Variables are checked separately via
`getVariableValues()` against the operation's variable definitions.

Deliberate non-check: an SDL says nothing about HTTP path or method, so there is
no GraphQL analogue of `request.path-or-method.unknown`. Documented so its
absence is not read as a gap.

**`responseBody.ts`** applies U4, then U1, then U2, then projects, strips
`required`, and compares with AJV.

**`subscriptionMessage.ts`** is the same pipeline rooted at the `Subscription`
type, comparing `contents.content.data`.

**`schemaProvenance.ts`** hashes the provider SDL once per `Comparator` and
compares it against `schema_ref.hash` and the SHA of `inline_schema.base64_sdl`,
emitting S1 once per Pact file. For S2 it parses the embedded SDL lazily — only
when a request-side error has already occurred and a delta would explain it.

**Caching.** Compiled validators are keyed on a digest of the normalised
operation document plus its operation name, so repeated interactions and
multi-pact runs reuse them.

## 9. Result codes

Additions to `src/results/index.ts`, following the existing `request.*` /
`response.*` prefix convention.

Errors: `request.graphql.document.invalid`, `request.graphql.operation.unknown`,
`request.graphql.field.unknown`, `request.graphql.argument.unknown`,
`request.graphql.argument.missing`, `request.graphql.variables.incompatible`,
`request.graphql.incompatible`, `response.graphql.body.incompatible`,
`message.graphql.payload.incompatible`.

Warnings: `graphql.schema.mismatch`, `request.graphql.inconsistent`,
`response.graphql.errors.unvalidatable`, `response.graphql.scalar.unvalidatable`,
`response.graphql.data.null`.

Info: `graphql.operation.matched`, for parity with `message.matched`.

## 10. Testing

Fixture-driven, following the existing pattern:
`src/__tests__/fixtures/graphql/<case>/{schema.graphql, pact.json, results.json}`.
The fixture harness needs teaching to read `.graphql` alongside `oas.yaml` and
`asyncapi.yaml`.

Cases, each traceable to a rule in the requirements: valid subset (R10); unknown
field (R4); missing required argument (R6); wrong variable type (R8); extra
response field (P1); **omitted response field, which must pass** (P7); invalid
enum value (P3); null on a non-null field (P4); interface and union with
fragments (P5); aliases (P1); custom scalar (U3); `errors` in response (U1);
schema digest mismatch (S1); subscription message; mixed REST + GraphQL pact;
GraphQL interaction with no SDL supplied.

Beyond the fixtures, `documents/graphql.test.ts` unit-tests the projection
directly. It is the one component where every other behaviour is downstream, so
it earns the most from test-first development.

## 11. Risks

**Bundling `graphql`.** `package.json` declares no `dependencies` at all —
everything is a devDependency and rollup bundles it — so adding `graphql` puts
graphql-js (~1.1MB unminified) into the published artifact. graphql-js is also
known to bundle awkwardly: its dual ESM/CJS packaging produces `instanceof`
failures at runtime ("Cannot use GraphQLSchema from another module") that unit
tests running from source do not catch.

Mitigation, and the first step of the implementation plan: add the dependency
and smoke-test `buildSchema` plus `validate` from the built `dist/index.cjs`
*and* `dist/index.mjs` before any feature code is written. Cheap now, expensive
to discover after the feature is built.

**Projection surface area.** Abstract types, fragments, aliases, and nullability
interact, and the projection is the single point where a mistake becomes a wrong
verdict. Mitigated by unit-testing it in isolation rather than only through
fixtures.

**Heuristic classification.** Condition 3 in §4 of the requirements infers
GraphQL from a request body. The key-closure and successful-parse guards make
false positives unlikely but not impossible; a misclassified REST interaction
would be compared against the wrong contract. Mitigated by a fixture asserting
that a REST endpoint taking a `query` string field is not misclassified.
