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
