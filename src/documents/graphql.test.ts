import { describe, expect, it } from "vitest";
import { ParserError, parse } from "./graphql";

const SDL = `
type Query { product(id: ID!): Product }
type Product { id: ID!, name: String! }
`;

describe("parse", () => {
  it("builds a schema from valid SDL", () => {
    const schema = parse(SDL);
    expect(schema.getQueryType()?.name).toBe("Query");
  });

  it("throws ParserError on a syntax error", () => {
    expect(() => parse("type Query {")).toThrow(ParserError);
  });

  it("throws ParserError when the schema is invalid", () => {
    // Missing Query root type is a schema validation error, not a syntax error
    expect(() => parse("type Product { id: ID! }")).toThrow(ParserError);
  });

  it("exposes the underlying GraphQL errors", () => {
    try {
      parse("type Query {");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ParserError).errors.length).toBeGreaterThan(0);
    }
  });
});
