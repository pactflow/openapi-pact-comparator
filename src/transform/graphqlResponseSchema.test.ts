import { parse as parseDocument } from "graphql";
import { describe, expect, it } from "vitest";
import { parse as parseSchema } from "#documents/graphql";
import { graphqlResponseSchema } from "./graphqlResponseSchema";

const schema = parseSchema(`
  type Product { id: ID!, name: String!, price: Price }
  type Price { amount: Float! }
  type Query { product(id: ID!): Product }
`);

const build = (source: string) =>
  graphqlResponseSchema(schema, parseDocument(source)).schema;

describe("graphqlResponseSchema", () => {
  it("removes required at the top level (P7, P8)", () => {
    const s = build("{ product(id: 1) { id name } }");
    expect(s.properties.data.properties.product.required).toBeUndefined();
  });

  it("removes required at every nesting level", () => {
    const s = build("{ product(id: 1) { price { amount } } }");
    expect(
      s.properties.data.properties.product.properties.price.required,
    ).toBeUndefined();
  });

  it("keeps additionalProperties false so unselected fields still fail (P1)", () => {
    const s = build("{ product(id: 1) { id } }");
    expect(s.properties.data.properties.product.additionalProperties).toBe(
      false,
    );
  });

  it("still surfaces unvalidatable scalars", () => {
    const withScalar = parseSchema(`
      scalar DateTime
      type Product { createdAt: DateTime! }
      type Query { product(id: ID!): Product }
    `);
    const { unvalidatableScalars } = graphqlResponseSchema(
      withScalar,
      parseDocument("{ product(id: 1) { createdAt } }"),
    );
    expect(unvalidatableScalars).toEqual(["data.product.createdAt"]);
  });
});
