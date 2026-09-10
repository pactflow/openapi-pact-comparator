import { describe, expect, it } from "vitest";
import {
  ParserError,
  fingerprint,
  looksLikeGraphqlDocument,
  parse,
} from "./graphql";

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

describe("fingerprint", () => {
  it("is stable across formatting differences", () => {
    const a =
      "type Query { product(id: ID!): Product }\ntype Product { id: ID! }";
    const b =
      "type   Product {\n  id: ID!\n}\n\ntype Query {\n  product(id: ID!): Product\n}\n";
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("differs when the schema differs", () => {
    const a =
      "type Query { product(id: ID!): Product }\ntype Product { id: ID! }";
    const b =
      "type Query { product(id: ID!): Product }\ntype Product { id: ID!, name: String }";
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("returns undefined for unparseable SDL rather than throwing", () => {
    expect(fingerprint("type Query {")).toBeUndefined();
  });
});

describe("looksLikeGraphqlDocument", () => {
  it("accepts a query document", () => {
    expect(
      looksLikeGraphqlDocument("query Q($id: ID!) { product(id: $id) { id } }"),
    ).toBe(true);
  });

  it("rejects a SQL-ish string", () => {
    expect(
      looksLikeGraphqlDocument("SELECT * FROM products WHERE id = 1"),
    ).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(looksLikeGraphqlDocument("")).toBe(false);
  });

  it("rejects a document containing no executable operation", () => {
    expect(looksLikeGraphqlDocument("type Query { a: String }")).toBe(false);
  });
});
