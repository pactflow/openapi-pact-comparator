import { describe, expect, it } from "vitest";
import { parse as parseSchema } from "#documents/graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import {
  checkSchemaProvenance,
  explainWithEmbeddedSchema,
} from "./schemaProvenance";

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

const provider = parseSchema(
  "type Query { product(id: ID!): Product }\ntype Product { id: ID! }",
);
const embedded =
  "type Query { product(id: ID!): Product }\ntype Product { id: ID!, type: String }";

const unknownField = (): Result => ({
  code: "request.graphql.field.unknown",
  message: 'Cannot query field "type" on type "Product". (line 1, column 20)',
  type: "error",
});

describe("explainWithEmbeddedSchema", () => {
  it("explains a field the consumer's schema had and the provider does not (S2)", () => {
    const [result] = explainWithEmbeddedSchema(
      [unknownField()],
      embedded,
      provider,
    );
    expect(result.causes).toHaveLength(1);
    expect(result.causes?.[0].message).toContain("Product.type");
    expect(result.causes?.[0].type).toBe("warning");
  });

  it("adds nothing when there is no embedded schema", () => {
    expect(
      explainWithEmbeddedSchema([unknownField()], undefined, provider)[0]
        .causes,
    ).toBeUndefined();
  });

  it("adds nothing when the embedded schema also lacks the field", () => {
    const same =
      "type Query { product(id: ID!): Product }\ntype Product { id: ID! }";
    expect(
      explainWithEmbeddedSchema([unknownField()], same, provider)[0].causes,
    ).toBeUndefined();
  });

  it("adds nothing when the embedded schema cannot be parsed (S3)", () => {
    expect(
      explainWithEmbeddedSchema([unknownField()], "type Query {", provider)[0]
        .causes,
    ).toBeUndefined();
  });

  it("never turns a warning into an error (S3)", () => {
    const warning: Result = {
      code: "graphql.schema.mismatch",
      message: "m",
      type: "warning",
    };
    const [result] = explainWithEmbeddedSchema([warning], embedded, provider);
    expect(result.type).toBe("warning");
  });

  it("leaves results it cannot explain untouched", () => {
    const other: Result = {
      code: "request.graphql.incompatible",
      message: "something unparseable",
      type: "error",
    };
    expect(
      explainWithEmbeddedSchema([other], embedded, provider)[0].causes,
    ).toBeUndefined();
  });
});
