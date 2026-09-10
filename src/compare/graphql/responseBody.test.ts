import { parse as parseDocument } from "graphql";
import { describe, expect, it } from "vitest";
import { setupAjv } from "#compare/setup";
import { parse as parseSchema } from "#documents/graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import { compareResponseBody } from "./responseBody";

const ajv = setupAjv({
  allErrors: true,
  coerceTypes: false,
  strictSchema: false,
  logger: false,
});

const schema = parseSchema(`
  scalar DateTime
  enum ProductStatus { ACTIVE DRAFT }
  type Product { id: ID!, name: String!, description: String, status: ProductStatus!, createdAt: DateTime! }
  type Query { product(id: ID!): Product }
`);

const QUERY = "{ product(id: 1) { id name status } }";

const interaction = (body: unknown, status = 200): GraphqlHttpInteraction => ({
  _kind: "graphql-http",
  description: "an interaction",
  providerState: "a state",
  operation: {
    source: "body",
    document: QUERY,
    variables: {},
    inconsistent: false,
  },
  request: { method: "POST", path: "/graphql" },
  response: { status, body },
});

const run = (body: unknown, status = 200, query = QUERY) =>
  compareResponseBody(
    ajv,
    schema,
    parseDocument(query),
    interaction(body, status),
    0,
  );

const ok = { data: { product: { id: "10", name: "n", status: "ACTIVE" } } };

describe("compareResponseBody", () => {
  it("passes a fully populated response", () => {
    expect(run(ok)).toEqual([]);
  });

  it("passes when the consumer omits a field it selected (P7)", () => {
    expect(run({ data: { product: { id: "10" } } })).toEqual([]);
  });

  it("passes when the consumer omits a non-null field (P8)", () => {
    expect(run({ data: { product: { name: "n" } } })).toEqual([]);
  });

  it("rejects a field the operation never selected (P1)", () => {
    const results = run({ data: { product: { id: "10", description: "d" } } });
    expect(results.map((r) => r.code)).toEqual([
      "response.graphql.body.incompatible",
    ]);
    expect(results[0].type).toBe("error");
  });

  it("rejects a scalar of the wrong type (P2)", () => {
    expect(run({ data: { product: { name: 42 } } }).map((r) => r.code)).toEqual(
      ["response.graphql.body.incompatible"],
    );
  });

  it("rejects a value outside the enum (P3)", () => {
    expect(
      run({ data: { product: { status: "PENDING" } } }).map((r) => r.code),
    ).toEqual(["response.graphql.body.incompatible"]);
  });

  it("rejects null on a non-null field when no errors key is present (P4)", () => {
    expect(run({ data: { product: { id: null } } }).map((r) => r.code)).toEqual(
      ["response.graphql.body.incompatible"],
    );
  });

  it("accepts null on a nullable field", () => {
    const results = run(
      { data: { product: { description: null } } },
      200,
      "{ product(id: 1) { description } }",
    );
    expect(results).toEqual([]);
  });

  it("rejects an unknown envelope key (P6)", () => {
    expect(run({ data: {}, meta: {} }).map((r) => r.code)).toEqual([
      "response.graphql.body.incompatible",
    ]);
  });

  it("warns and skips data checks when errors are present (U1)", () => {
    const results = run({ errors: [{ message: "boom" }], data: null });
    expect(results.map((r) => r.code)).toEqual([
      "response.graphql.errors.unvalidatable",
    ]);
    expect(results[0].type).toBe("warning");
  });

  it("warns and skips when data is null (U2)", () => {
    const results = run({ data: null });
    expect(results.map((r) => r.code)).toEqual(["response.graphql.data.null"]);
    expect(results[0].type).toBe("warning");
  });

  it("warns for a custom scalar and accepts any value (U3)", () => {
    const results = run(
      { data: { product: { createdAt: 12345 } } },
      200,
      "{ product(id: 1) { createdAt } }",
    );
    expect(results.map((r) => r.code)).toEqual([
      "response.graphql.scalar.unvalidatable",
    ]);
    expect(results[0].type).toBe("warning");
  });

  it("warns and skips body checks on a transport failure (U4)", () => {
    const results = run({ anything: true }, 500);
    expect(results.map((r) => r.code)).toEqual([
      "response.graphql.status.unexpected",
    ]);
    expect(results[0].type).toBe("warning");
  });

  it("carries pact and schema locations", () => {
    const [result] = run({ data: { product: { status: "PENDING" } } });
    expect(result.mockDetails?.location).toBe(
      "[root].interactions[0].response.body.content.data.product.status",
    );
    expect(result.mockDetails?.interactionDescription).toBe("an interaction");
    expect(result.specDetails?.location).toBe("[root].Query");
  });
});
