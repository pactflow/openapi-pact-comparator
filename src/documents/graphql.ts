import {
  GraphQLError,
  type GraphQLSchema,
  buildSchema,
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
