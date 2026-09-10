import { createHash } from "node:crypto";
import {
  GraphQLError,
  type GraphQLSchema,
  Kind,
  buildSchema,
  lexicographicSortSchema,
  parse as parseDocument,
  printSchema,
  validateSchema,
} from "graphql";

export class ParserError extends Error {
  errors: readonly GraphQLError[];

  constructor(errors: readonly GraphQLError[]) {
    super("Malformed GraphQL schema");
    this.errors = errors;
  }
}

export const parse = (sdl: string): GraphQLSchema => {
  let schema: GraphQLSchema;
  try {
    schema = buildSchema(sdl, { assumeValidSDL: false });
  } catch (e) {
    throw new ParserError([
      e instanceof GraphQLError ? e : new GraphQLError(String(e)),
    ]);
  }

  const errors = validateSchema(schema);
  if (errors.length) {
    throw new ParserError(errors);
  }

  return schema;
};

/**
 * A stable fingerprint of a schema's *meaning*, not its text. Normalising
 * through printSchema() means whitespace and declaration order do not produce
 * a spurious provenance mismatch (S1).
 *
 * Returns undefined when the SDL cannot be parsed — a consumer's embedded
 * schema is diagnostic input only and must never break a comparison (S3).
 */
export const fingerprint = (sdl: string): string | undefined => {
  try {
    return createHash("sha256")
      .update(printSchema(lexicographicSortSchema(parse(sdl))), "utf-8")
      .digest("hex");
  } catch {
    return undefined;
  }
};

/**
 * Whether a string parses as a GraphQL document containing at least one
 * executable operation. Used as the strong guard on heuristic classification
 * of non-plugin GraphQL pacts (requirements section 4, condition 3).
 */
export const looksLikeGraphqlDocument = (source: string): boolean => {
  if (!source.trim()) return false;
  try {
    const document = parseDocument(source);
    return document.definitions.some(
      (d) => d.kind === Kind.OPERATION_DEFINITION,
    );
  } catch {
    return false;
  }
};
