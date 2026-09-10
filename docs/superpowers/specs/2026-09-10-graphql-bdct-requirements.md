# GraphQL Bi-Directional Contract Testing — Requirements

Status: draft
Date: 2026-09-10
Companion document: [2026-09-10-graphql-bdct-design.md](./2026-09-10-graphql-bdct-design.md)

This document defines the **business rules** for comparing a consumer Pact file
against a GraphQL provider contract. It is normative and implementation
agnostic: it says what compatibility means, not how the comparator is built.
The design document says how.

## 1. Purpose and scope

Bi-Directional Contract Testing (BDCT) compares a provider contract against a
consumer contract without running either system. This document extends that
model to GraphQL.

- **Provider contract**: a GraphQL schema, supplied as SDL text.
- **Consumer contract**: a Pact file containing one or more GraphQL
  interactions.

A comparison answers one question: **could this provider satisfy this
consumer?** It never asks whether the provider is correct, whether the consumer
is well written, or whether the two were built from the same schema version.

### In scope

- GraphQL queries and mutations expressed as `Synchronous/HTTP` interactions.
- GraphQL subscriptions expressed as `Asynchronous/Messages` interactions.
- Pact files containing a mix of GraphQL and REST interactions.
- Diagnostics derived from a schema embedded in the consumer contract.

### Out of scope

- Consumer-side `matchingRules`. The provider schema already carries stronger
  type information than a matcher can express, and honouring both invites
  contradictory verdicts. Rules present in the Pact file are ignored.
- The plugin's `query_matching` mode (`exact` / `semantic` / `subset`). It
  governs how a mock server matches a request at consumer test time and has no
  bearing on provider compatibility.
- Transport concerns: HTTP path, method, status code semantics, persisted
  queries, batching, `@defer`/`@stream` incremental delivery, and multipart
  uploads.
- Schema evolution or breaking-change detection between two provider schema
  versions.

## 2. Definitions

- **Operation**: a single query, mutation, or subscription defined in the
  consumer's GraphQL document, identified by `operationName` where present.
- **Selection set**: the tree of fields an operation requests.
- **Projection**: the response shape implied by applying a selection set to the
  provider schema. Because GraphQL responses mirror their selection set, the
  projection is exact — unlike REST, where a schema describes many possible
  bodies.
- **Provider-impossible**: a recorded value the provider could never emit for
  the given operation, regardless of state or data.

## 3. The subset rule

Compatibility is asymmetric, and the two directions have different rules.

### 3.1 Request: the consumer must ask only for what the provider offers

An interaction's request is compatible when its operation is **valid against
the provider schema** under the GraphQL specification's own validation rules.
Concretely:

| #   | Rule                                                                                                                                         | Verdict when violated |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| R1  | The document must be syntactically valid GraphQL.                                                                                            | error                 |
| R2  | The named operation must exist in the document; if `operationName` is absent, the document must contain exactly one operation.               | error                 |
| R3  | Every root field must exist on the schema's `Query`, `Mutation`, or `Subscription` type, as matches the operation type.                      | error                 |
| R4  | Every selected field must exist on its parent type.                                                                                          | error                 |
| R5  | Every argument supplied must exist on the field it is passed to.                                                                             | error                 |
| R6  | Every argument the provider declares as required — non-null with no default — must be supplied.                                              | error                 |
| R7  | Argument and variable values must be type-compatible with their declarations, including enum membership and input-object field requirements. | error                 |
| R8  | Every required variable must be given a value; supplied variables must coerce to their declared types.                                       | error                 |
| R9  | Fragments and inline fragments must target types that exist and can apply at their spread location.                                          | error                 |
| R10 | Selecting **fewer** fields than the provider offers is always compatible.                                                                    | pass                  |

Rules R1–R9 are the GraphQL specification's validation rules, not a
comparator-specific invention. R10 is the substance of the subset rule and is
also simply what GraphQL validation permits — the design deliberately leans on
this rather than re-deriving it.

The provider schema describes an API surface, not a transport. It says nothing
about which HTTP path or method serves an operation, so neither is checked.

### 3.2 Response: the consumer may know less than the provider returns

A recorded response is compatible when nothing in it is provider-impossible.
The projection of the operation's selection set defines what is possible.

| #   | Rule                                                                                                                                                | Verdict when violated |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| P1  | Every key in `data` must correspond to a field the operation selected, keyed by alias where one is used.                                            | error                 |
| P2  | Every recorded scalar value must satisfy its field's type.                                                                                          | error                 |
| P3  | Every recorded enum value must be a member of that enum.                                                                                            | error                 |
| P4  | A field declared non-null must not be recorded as `null` when no `errors` key is present, because the provider cannot produce that.                 | error                 |
| P5  | A value for an abstract type (interface or union) must match at least one of its possible concrete types, as narrowed by any `__typename` recorded. | error                 |
| P6  | The response envelope must contain only `data`, `errors`, and `extensions`.                                                                         | error                 |
| P7  | Omitting a field the operation selected is compatible — the consumer is not asserting on it.                                                        | pass                  |
| P8  | Omitting a field the provider declares non-null is compatible, for the same reason.                                                                 | pass                  |

P7 and P8 are the response-side subset rule and are the reason a naive
"validate the body against the schema" approach is wrong: the projection must
have its `required` constraints stripped before comparison, while retaining
closure against unknown fields.

### 3.3 Values the comparator cannot judge

Some recorded values are neither compatible nor incompatible, because the
schema does not describe them. These produce **warnings**, never errors, and
suppress the checks that depend on them:

| #   | Case                                   | Behaviour                                                                        |
| --- | -------------------------------------- | -------------------------------------------------------------------------------- |
| U1  | The response contains an `errors` key. | warn; skip all `data` checks — error payloads are not described by the schema    |
| U2  | `data` is `null`.                      | warn; skip remaining `data` checks                                               |
| U3  | A field's type is a custom scalar.     | warn; accept any value for that field                                            |
| U4  | The HTTP status is 400 or above.       | warn; skip all body checks — this is a transport failure, not a schema statement |

## 4. Which interactions are GraphQL

A `Synchronous/HTTP` interaction is treated as GraphQL when **any** of:

1. It carries a `pluginConfiguration.graphql` block, or
2. its request content type is `application/graphql`, or
3. its method is `POST`, its body is an object whose keys are a subset of
   `{query, variables, operationName, extensions}`, and `query` is a string
   that parses as a GraphQL document.

Condition 3 exists so that consumers who hand-roll GraphQL Pacts, or use
pact-js's older `GraphQLInteraction`, are supported without the plugin. Its two
guards — key closure and a successful parse — keep a REST endpoint that happens
to take a `query` field from being misclassified.

An `Asynchronous/Messages` interaction is treated as GraphQL when it carries a
`pluginConfiguration.graphql` block. There is no established non-plugin
convention for GraphQL subscription messages, so no heuristic applies.

### 4.1 Where the operation is read from

Where both a plugin configuration and a request body are present, the plugin
configuration is authoritative for the operation document, operation name, and
variables. If the two disagree, that is a **warning**: it means the Pact file
was edited after the plugin wrote it, and the comparator reports what it used.

## 5. Mixed and incomplete contracts

A Pact file may contain GraphQL and REST interactions together — a realistic
shape for a gateway. Each interaction is compared against whichever provider
contract matches its kind: GraphQL interactions against the SDL, REST
interactions against an OpenAPI document, message interactions against an
AsyncAPI document.

An interaction whose matching provider contract was not supplied is **skipped
silently**. This is consistent with the comparator's existing behaviour for
OpenAPI and AsyncAPI. It is a known sharp edge — a run can report success
having compared nothing — and is recorded here as a deliberate consistency
choice rather than an oversight. Changing it should be done for all contract
types at once, not for GraphQL alone.

## 6. Schema provenance

The plugin may embed, in each interaction, the schema the consumer was built
against: an SDL blob under `inline_schema.base64_sdl` and a digest under
`schema_ref.hash`.

This embedded schema is a **snapshot of the provider's schema at consumer build
time**. It is not a statement of what the consumer needs. It must therefore
never be diffed against the provider contract to decide pass or fail: doing so
would fail every provider change the consumer never used — a removed deprecated
field, a renamed type in an untouched corner, a new required argument on an
unrelated mutation — which is precisely the coupling BDCT exists to remove.

Its legitimate uses are:

| #   | Rule                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | When the embedded schema's digest differs from the provider contract's, emit one warning per Pact file, never per interaction.                                                                                                                                                             |
| S2  | When a request-side rule (R3–R9) is violated and an embedded schema is available, attach the specific delta as a cause — for example, "`Product.type` exists in the schema this consumer was built against and is absent from the provider contract" — in place of a bare "unknown field". |
| S3  | Neither S1 nor S2 may change a pass into a failure.                                                                                                                                                                                                                                        |

## 7. Verdict summary

- A comparison **fails** when any rule in §3.1 or §3.2 is violated.
- A comparison **passes with warnings** when only §3.3, §4.1, or §6 apply.
- A comparison **passes** otherwise.

Every result carries the location in the Pact file that provoked it and, where
one can be derived, the location in the provider schema it conflicts with.

## 8. Worked example

Given the provider schema:

```graphql
type Query {
  product(id: ID!): Product
}

type Product {
  id: ID!
  name: String!
  status: ProductStatus!
  description: String
}

enum ProductStatus {
  ACTIVE
  DRAFT
  OUT_OF_STOCK
  ARCHIVED
}
```

| Consumer interaction                                                                         | Verdict           | Rule                                                                |
| -------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------- |
| `{ product(id: $id) { id name } }`, response `{"data":{"product":{"id":"10","name":"x"}}}`   | pass              | R10 — asking for fewer fields is the point                          |
| `{ product(id: $id) { id name } }`, response `{"data":{"product":{"id":"10"}}}`              | pass              | P7 — the consumer asserts on less than it asked for                 |
| `{ product { id } }`                                                                         | fail              | R6 — `id` is a required argument                                    |
| `{ product(id: $id) { id stockLevel } }`                                                     | fail              | R4 — `stockLevel` is not a field of `Product`                       |
| `{ product(id: $id) { id } }`, response `{"data":{"product":{"id":"10","name":"x"}}}`        | fail              | P1 — `name` was never selected, so the provider would not return it |
| `{ product(id: $id) { status } }`, response `{"data":{"product":{"status":"PENDING"}}}`      | fail              | P3 — not a member of `ProductStatus`                                |
| `{ product(id: $id) { id } }`, response `{"data":{"product":{"id":null}}}`                   | fail              | P4 — `id` is non-null and no `errors` key is present                |
| `{ product(id: $id) { description } }`, response `{"data":{"product":{"description":null}}}` | pass              | `description` is nullable                                           |
| any operation, response `{"errors":[{"message":"boom"}]}`                                    | pass with warning | U1                                                                  |
