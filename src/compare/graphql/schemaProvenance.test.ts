import { describe, expect, it } from "vitest";
import type { GraphqlHttpInteraction } from "#documents/pact";
import { checkSchemaProvenance } from "./schemaProvenance";

const PROVIDER_SDL =
  "type Query { product(id: ID!): Product }\ntype Product { id: ID! }";
const CONSUMER_SDL =
  "type Query { product(id: ID!): Product }\ntype Product { id: ID!, type: String }";

const interaction = (
  plugin?: GraphqlHttpInteraction["plugin"],
): GraphqlHttpInteraction => ({
  _kind: "graphql-http",
  description: "an interaction",
  operation: {
    source: "plugin",
    document: "{ product(id: 1) { id } }",
    variables: {},
    inconsistent: false,
  },
  request: { method: "POST", path: "/graphql" },
  response: { status: 200 },
  plugin,
});

const run = (
  plugin?: GraphqlHttpInteraction["plugin"],
  state = { reported: false },
) => [...checkSchemaProvenance(state, PROVIDER_SDL, interaction(plugin), 0)];

describe("checkSchemaProvenance", () => {
  it("says nothing when there is no embedded schema", () => {
    expect(run(undefined)).toEqual([]);
  });

  it("says nothing when the embedded schema matches", () => {
    expect(run({ inlineSchemaSdl: PROVIDER_SDL })).toEqual([]);
  });

  it("warns when the embedded schema differs (S1)", () => {
    const results = run({ inlineSchemaSdl: CONSUMER_SDL });
    expect(results.map((r) => r.code)).toEqual(["graphql.schema.mismatch"]);
    expect(results[0].type).toBe("warning");
  });

  it("warns only once per pact (S1)", () => {
    const state = { reported: false };
    expect(run({ inlineSchemaSdl: CONSUMER_SDL }, state)).toHaveLength(1);
    expect(run({ inlineSchemaSdl: CONSUMER_SDL }, state)).toHaveLength(0);
  });

  it("ignores an unparseable embedded schema rather than failing (S3)", () => {
    expect(run({ inlineSchemaSdl: "type Query {" })).toEqual([]);
  });

  it("never produces an error result (S3)", () => {
    const results = run({ inlineSchemaSdl: CONSUMER_SDL });
    expect(results.every((r) => r.type !== "error")).toBe(true);
  });
});
