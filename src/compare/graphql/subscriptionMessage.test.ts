import { describe, expect, it } from "vitest";
import { setupAjv } from "#compare/setup";
import { parse as parseSchema } from "#documents/graphql";
import type { GraphqlMessageInteraction } from "#documents/pact";
import { compareGraphqlMessageInteraction } from "./subscriptionMessage";

const ajv = setupAjv({
  allErrors: true,
  coerceTypes: false,
  strictSchema: false,
  logger: false,
});

const schema = parseSchema(`
  type Inventory { quantity: Int!, updatedAt: String! }
  type Query { placeholder: String }
  type Subscription { inventoryChanged(variantId: ID!): Inventory! }
`);

const DOC =
  "subscription S($variantId: ID!) { inventoryChanged(variantId: $variantId) { quantity } }";

const interaction = (payload: unknown): GraphqlMessageInteraction => ({
  _kind: "graphql-message",
  description: "an inventory message",
  operation: {
    source: "plugin",
    document: DOC,
    operationName: "S",
    variables: { variantId: "v1" },
    inconsistent: false,
  },
  payload,
});

const run = (payload: unknown) => [
  ...compareGraphqlMessageInteraction(ajv, schema, interaction(payload), 0),
];

describe("compareGraphqlMessageInteraction", () => {
  it("matches a compatible subscription payload", () => {
    expect(
      run({ data: { inventoryChanged: { quantity: 42 } } }).map((r) => r.code),
    ).toEqual(["graphql.operation.matched"]);
  });

  it("allows an omitted field (P7)", () => {
    expect(run({ data: { inventoryChanged: {} } }).map((r) => r.code)).toEqual([
      "graphql.operation.matched",
    ]);
  });

  it("rejects a field that was never selected (P1)", () => {
    expect(
      run({ data: { inventoryChanged: { quantity: 1, updatedAt: "x" } } }).map(
        (r) => r.code,
      ),
    ).toEqual(["message.graphql.payload.incompatible"]);
  });

  it("rejects a scalar of the wrong type (P2)", () => {
    expect(
      run({ data: { inventoryChanged: { quantity: "lots" } } }).map(
        (r) => r.code,
      ),
    ).toEqual(["message.graphql.payload.incompatible"]);
  });

  it("rejects a subscription field the schema does not have (R4)", () => {
    const i = interaction({ data: {} });
    i.operation.document = "subscription S { nope { id } }";
    expect(
      [...compareGraphqlMessageInteraction(ajv, schema, i, 0)].map(
        (r) => r.code,
      ),
    ).toEqual(["request.graphql.field.unknown"]);
  });
});
