import { describe, expect, it } from "vitest";
import { Comparator } from "#compare/index";

const SDL = `
  enum ProductStatus { ACTIVE DRAFT }
  type Product { id: ID!, name: String!, status: ProductStatus! }
  type Query { product(id: ID!): Product }
`;

const QUERY = "query GetProduct($id: ID!) { product(id: $id) { id name } }";

const pact = (overrides: Record<string, unknown> = {}) => ({
  consumer: { name: "c" },
  provider: { name: "p" },
  metadata: { pactSpecification: { version: "4.0" } },
  interactions: [
    {
      type: "Synchronous/HTTP",
      description: "a GraphQL product request",
      request: {
        method: "POST",
        path: "/graphql",
        body: {
          encoded: false,
          content: { query: QUERY, variables: { id: "10" } },
        },
      },
      response: {
        status: 200,
        body: {
          encoded: false,
          content: { data: { product: { id: "10", name: "n" } } },
        },
      },
      ...overrides,
    },
  ],
});

const collect = async (options: object, doc: unknown) => {
  const results = [];
  for await (const r of new Comparator(options).compare(doc as never))
    results.push(r);
  return results;
};

describe("Comparator with a graphql provider contract", () => {
  it("emits a matched result for a compatible interaction", async () => {
    const results = await collect({ graphql: SDL }, pact());
    expect(results.map((r) => r.code)).toEqual(["graphql.operation.matched"]);
    expect(results[0].type).toBe("info");
  });

  it("reports an incompatible request", async () => {
    const bad = pact();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bad.interactions[0] as any).request.body.content.query =
      "query GetProduct($id: ID!) { product(id: $id) { id stockLevel } }";
    const results = await collect({ graphql: SDL }, bad);
    expect(results.map((r) => r.code)).toEqual([
      "request.graphql.field.unknown",
    ]);
  });

  it("skips the response check when the request is incompatible", async () => {
    const bad = pact();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bad.interactions[0] as any).request.body.content.query = "{ nope { id } }";
    const results = await collect({ graphql: SDL }, bad);
    expect(results.every((r) => r.code.startsWith("request."))).toBe(true);
  });

  it("skips graphql interactions when no SDL was supplied", async () => {
    expect(await collect({}, pact())).toEqual([]);
  });

  it("throws on malformed SDL", () => {
    expect(() => new Comparator({ graphql: "type Query {" })).toThrow();
  });
});
