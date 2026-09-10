import { describe, expect, it } from "vitest";
import { parse as parseSchema } from "#documents/graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import { compareRequestOperation } from "./requestOperation";

const schema = parseSchema(`
  enum ProductStatus { ACTIVE DRAFT }
  type Product { id: ID!, name: String!, status: ProductStatus! }
  type Query { product(id: ID!): Product, products(status: ProductStatus): [Product!]! }
`);

const interaction = (
  document: string,
  variables: Record<string, unknown> = {},
  operationName?: string,
): GraphqlHttpInteraction => ({
  _kind: "graphql-http",
  description: "an interaction",
  providerState: "a state",
  operation: {
    source: "body",
    document,
    operationName,
    variables,
    inconsistent: false,
  },
  request: { method: "POST", path: "/graphql" },
  response: { status: 200 },
});

const codes = (document: string, variables?: Record<string, unknown>) =>
  compareRequestOperation(
    schema,
    interaction(document, variables),
    0,
  ).results.map((r) => r.code);

describe("compareRequestOperation", () => {
  it("passes an operation that selects fewer fields (R10)", () => {
    const check = compareRequestOperation(
      schema,
      interaction("query Q($id: ID!) { product(id: $id) { id } }", { id: "1" }),
      0,
    );
    expect(check.results).toEqual([]);
    expect(check.document).toBeDefined();
  });

  it("reports a syntax error (R1)", () => {
    expect(codes("query {")).toEqual(["request.graphql.document.invalid"]);
  });

  it("reports a missing named operation (R2)", () => {
    const check = compareRequestOperation(
      schema,
      interaction("query A { product(id: 1) { id } }", {}, "B"),
      0,
    );
    expect(check.results.map((r) => r.code)).toEqual([
      "request.graphql.operation.unknown",
    ]);
    expect(check.document).toBeUndefined();
  });

  it("reports an unknown field (R4)", () => {
    expect(codes("{ product(id: 1) { id stockLevel } }")).toEqual([
      "request.graphql.field.unknown",
    ]);
  });

  it("reports an unknown root field (R3)", () => {
    expect(codes("{ nope { id } }")).toEqual(["request.graphql.field.unknown"]);
  });

  it("reports a missing required argument (R6)", () => {
    expect(codes("{ product { id } }")).toEqual([
      "request.graphql.argument.missing",
    ]);
  });

  it("reports an unknown argument (R5)", () => {
    expect(codes('{ product(id: 1, colour: "red") { id } }')).toEqual([
      "request.graphql.argument.unknown",
    ]);
  });

  it("reports an invalid enum literal (R7)", () => {
    expect(codes("{ products(status: PENDING) { id } }")).toEqual([
      "request.graphql.incompatible",
    ]);
  });

  it("reports a missing required variable (R8)", () => {
    expect(codes("query Q($id: ID!) { product(id: $id) { id } }", {})).toEqual([
      "request.graphql.variables.incompatible",
    ]);
  });

  it("reports a variable of the wrong type (R8)", () => {
    expect(
      codes(
        "query Q($status: ProductStatus!) { products(status: $status) { id } }",
        {
          status: "PENDING",
        },
      ),
    ).toEqual(["request.graphql.variables.incompatible"]);
  });

  it("reports a fragment on an unknown type (R9)", () => {
    expect(codes("{ product(id: 1) { ... on Nope { id } } }")).toEqual([
      "request.graphql.incompatible",
    ]);
  });

  it("warns when plugin config and body disagree (4.1)", () => {
    const i = interaction("{ product(id: 1) { id } }");
    i.operation.inconsistent = true;
    i.operation.source = "plugin";
    const results = compareRequestOperation(schema, i, 0).results;
    expect(results.map((r) => r.code)).toEqual([
      "request.graphql.inconsistent",
    ]);
    expect(results[0].type).toBe("warning");
  });

  it("carries pact and schema locations on each result", () => {
    const [result] = compareRequestOperation(
      schema,
      interaction("{ product(id: 1) { id stockLevel } }"),
      3,
    ).results;
    expect(result.mockDetails?.location).toBe(
      "[root].interactions[3].request.body.content.query",
    );
    expect(result.mockDetails?.interactionDescription).toBe("an interaction");
    expect(result.mockDetails?.interactionState).toBe("a state");
    expect(result.specDetails?.location).toBe("[root].Product");
  });
});
