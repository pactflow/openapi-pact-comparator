import { parse as parseDocument } from "graphql";
import { describe, expect, it } from "vitest";
import { parse as parseSchema } from "./graphql";
import { projectOperation } from "./graphqlProjection";

const schema = parseSchema(`
  scalar DateTime
  enum ProductStatus { ACTIVE DRAFT OUT_OF_STOCK ARCHIVED }
  type Money { amount: Float!, currency: String! }
  type Product {
    id: ID!
    name: String!
    description: String
    status: ProductStatus!
    tags: [String!]!
    price: Money
    createdAt: DateTime!
    stock: Int
    active: Boolean!
  }
  type Query { product(id: ID!): Product }
`);

const project = (source: string, operationName?: string) =>
  projectOperation(schema, parseDocument(source), operationName);

describe("projectOperation", () => {
  it("wraps the projection in a GraphQL response envelope", () => {
    const { schema: s } = project("{ product(id: 1) { id } }");
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties)).toEqual(["data", "errors", "extensions"]);
    expect(s.properties.errors).toBe(true);
    expect(s.properties.extensions).toBe(true);
  });

  it("maps built-in scalars to JSON Schema types", () => {
    const { schema: s } = project(
      "{ product(id: 1) { id name stock active } }",
    );
    const p = s.properties.data.properties.product.properties;
    expect(p.id).toEqual({ type: ["string", "integer"] });
    expect(p.name).toEqual({ type: "string" });
    expect(p.stock).toEqual({ type: ["integer", "null"] });
    expect(p.active).toEqual({ type: "boolean" });
  });

  it("maps enums to an enum constraint, adding null when nullable", () => {
    const { schema: s } = project("{ product(id: 1) { status } }");
    expect(s.properties.data.properties.product.properties.status).toEqual({
      enum: ["ACTIVE", "DRAFT", "OUT_OF_STOCK", "ARCHIVED"],
    });
  });

  it("makes nullable fields nullable", () => {
    const { schema: s } = project("{ product(id: 1) { description } }");
    expect(s.properties.data.properties.product.properties.description).toEqual(
      { type: ["string", "null"] },
    );
  });

  it("projects lists", () => {
    const { schema: s } = project("{ product(id: 1) { tags } }");
    expect(s.properties.data.properties.product.properties.tags).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it("recurses into object types and closes them", () => {
    const { schema: s } = project("{ product(id: 1) { price { amount } } }");
    const price = s.properties.data.properties.product.properties.price;
    expect(price.type).toEqual(["object", "null"]);
    expect(price.additionalProperties).toBe(false);
    expect(price.properties).toEqual({ amount: { type: "number" } });
    expect(price.required).toEqual(["amount"]);
  });

  it("closes every object so unselected fields are rejected (P1)", () => {
    const { schema: s } = project("{ product(id: 1) { id } }");
    const product = s.properties.data.properties.product;
    expect(product.additionalProperties).toBe(false);
    expect(Object.keys(product.properties)).toEqual(["id"]);
  });

  it("keys properties by alias where one is used", () => {
    const { schema: s } = project("{ product(id: 1) { productId: id } }");
    expect(
      Object.keys(s.properties.data.properties.product.properties),
    ).toEqual(["productId"]);
  });

  it("accepts any value for a custom scalar and reports the path (U3)", () => {
    const { schema: s, unvalidatableScalars } = project(
      "{ product(id: 1) { createdAt } }",
    );
    expect(s.properties.data.properties.product.properties.createdAt).toBe(
      true,
    );
    expect(unvalidatableScalars).toEqual(["data.product.createdAt"]);
  });

  it("makes data itself nullable (U2 is handled by the comparator)", () => {
    const { schema: s } = project("{ product(id: 1) { id } }");
    expect(s.properties.data.type).toEqual(["object", "null"]);
  });

  it("marks fields carrying @skip or @include as optional", () => {
    const { schema: s } = project(
      "query Q($d: Boolean!) { product(id: 1) { id name @include(if: $d) } }",
    );
    expect(s.properties.data.properties.product.required).toEqual(["id"]);
  });

  it("selects the named operation from a multi-operation document", () => {
    const { schema: s } = project(
      `query A { product(id: 1) { id } }
       query B { product(id: 1) { name } }`,
      "B",
    );
    expect(
      Object.keys(s.properties.data.properties.product.properties),
    ).toEqual(["name"]);
  });

  it("throws when the named operation is absent (R2)", () => {
    expect(() => project("query A { product(id: 1) { id } }", "Nope")).toThrow(
      /operation/i,
    );
  });

  it("throws when the document has several operations and no name (R2)", () => {
    expect(() =>
      project(`query A { product(id: 1) { id } }
               query B { product(id: 1) { name } }`),
    ).toThrow(/operation/i);
  });
});

const polySchema = parseSchema(`
  interface Node { id: ID! }
  type Product implements Node { id: ID!, name: String! }
  type Category implements Node { id: ID!, slug: String! }
  union SearchResult = Product | Category
  type Query {
    node(id: ID!): Node
    search(text: String!): [SearchResult!]!
  }
`);

const projectPoly = (source: string, operationName?: string) =>
  projectOperation(polySchema, parseDocument(source), operationName);

interface Branch {
  type?: string;
  properties: Record<string, unknown>;
}

describe("projectOperation with abstract types", () => {
  it("expands an interface into one branch per possible type", () => {
    const { schema: s } = projectPoly(
      "{ node(id: 1) { id ... on Product { name } ... on Category { slug } } }",
    );
    const node = s.properties.data.properties.node;
    expect(node.anyOf).toHaveLength(3); // Product, Category, null
    const branches = node.anyOf.filter((b: Branch) => b.type === "object");
    expect(
      branches.map((b: Branch) => Object.keys(b.properties).sort()),
    ).toEqual([
      ["id", "name"],
      ["id", "slug"],
    ]);
  });

  it("keeps interface-level fields required in every branch", () => {
    const { schema: s } = projectPoly(
      "{ node(id: 1) { id ... on Product { name } } }",
    );
    const branches = s.properties.data.properties.node.anyOf.filter(
      (b: Branch) => b.type === "object",
    );
    for (const branch of branches) expect(branch.required).toContain("id");
  });

  it("collapses to a single branch when no type conditions are used", () => {
    const { schema: s } = projectPoly("{ node(id: 1) { id } }");
    const node = s.properties.data.properties.node;
    expect(node.anyOf).toBeUndefined();
    expect(node.type).toEqual(["object", "null"]);
    expect(Object.keys(node.properties)).toEqual(["id"]);
  });

  it("expands a union", () => {
    const { schema: s } = projectPoly(
      '{ search(text: "x") { ... on Product { name } ... on Category { slug } } }',
    );
    const items = s.properties.data.properties.search.items;
    expect(items.anyOf).toHaveLength(2);
  });

  it("resolves named fragment spreads", () => {
    const { schema: s } = projectPoly(
      `{ node(id: 1) { id ...P } }
       fragment P on Product { name }`,
    );
    const branches = s.properties.data.properties.node.anyOf.filter(
      (b: Branch) => b.type === "object",
    );
    const product = branches.find((b: Branch) => "name" in b.properties);
    expect(Object.keys(product.properties).sort()).toEqual(["id", "name"]);
  });

  it("resolves an inline fragment with no type condition", () => {
    const { schema: s } = projectPoly("{ node(id: 1) { ... { id } } }");
    expect(Object.keys(s.properties.data.properties.node.properties)).toEqual([
      "id",
    ]);
  });

  it("constrains __typename to the possible type names in each branch", () => {
    const { schema: s } = projectPoly("{ node(id: 1) { __typename id } }");
    expect(s.properties.data.properties.node.properties.__typename).toEqual({
      enum: ["Product", "Category"],
    });
  });

  it("constrains __typename on a concrete object type to that one name", () => {
    const { schema: s } = projectPoly(
      "{ node(id: 1) { ... on Product { __typename name } } }",
    );
    const branches = s.properties.data.properties.node.anyOf.filter(
      (b: Branch) => b.type === "object",
    );
    const product = branches.find((b: Branch) => "name" in b.properties);
    expect(product.properties.__typename).toEqual({ enum: ["Product"] });
  });

  it("does not loop on a fragment that spreads itself", () => {
    // validate() rejects fragment cycles, but the projection must not hang
    // if a future caller skips validation.
    expect(() =>
      projectPoly(
        `{ node(id: 1) { ...P } }
         fragment P on Product { name ...P }`,
      ),
    ).not.toThrow();
  });
});
