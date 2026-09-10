import {
  type DocumentNode,
  type GraphQLError,
  type GraphQLSchema,
  Kind,
  coerceInputValue,
  isInputType,
  parse as parseDocument,
  typeFromAST,
  validate,
} from "graphql";
import { ProjectionError, selectOperation } from "#documents/graphqlProjection";
import type { GraphqlHttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";

export interface RequestCheck {
  results: Result[];
  /** Present only when the request is compatible, so the caller may proceed. */
  document?: DocumentNode;
}

/**
 * Maps a GraphQL validation error onto a specific result code. graphql-js does
 * not expose the rule that produced an error, so the message is the only
 * signal available; anything unrecognised falls back to the catch-all, which
 * still reports the full GraphQL message.
 */
const codeForValidationError = (
  error: GraphQLError,
): Extract<Result["code"], `request.graphql.${string}`> => {
  const message = error.message;
  if (/^Unknown argument /.test(message))
    return "request.graphql.argument.unknown";
  if (/^Field .* argument .* of type .* is required/.test(message)) {
    return "request.graphql.argument.missing";
  }
  if (/^Cannot query field /.test(message))
    return "request.graphql.field.unknown";
  if (/^Unknown type /.test(message)) return "request.graphql.incompatible";
  return "request.graphql.incompatible";
};

/** `[root].<TypeName>` where the error names a type, for specDetails. */
const specLocation = (error: GraphQLError): string => {
  const match =
    /on type "([^"]+)"/.exec(error.message) ??
    /Field "([^".]+)\./.exec(error.message);
  return match ? `[root].${match[1]}` : "[root]";
};

const position = (error: GraphQLError): string => {
  const loc = error.locations?.[0];
  return loc ? ` (line ${loc.line}, column ${loc.column})` : "";
};

export const compareRequestOperation = (
  schema: GraphQLSchema,
  interaction: GraphqlHttpInteraction,
  index: number,
): RequestCheck => {
  const results: Result[] = [];
  const queryLocation = `[root].interactions[${index}].request.body.content.query`;
  const mock = (location: string, value: unknown) => ({
    ...baseMockDetails(interaction),
    location,
    value,
  });

  if (interaction.operation.inconsistent) {
    results.push({
      code: "request.graphql.inconsistent",
      message:
        "The GraphQL operation in the request body differs from the one in pluginConfiguration.graphql; the plugin configuration was used",
      mockDetails: mock(queryLocation, interaction.operation.document),
      specDetails: { location: "[root]", value: undefined },
      type: "warning",
    });
  }

  // R1
  let document: DocumentNode;
  try {
    document = parseDocument(interaction.operation.document);
  } catch (e) {
    results.push({
      code: "request.graphql.document.invalid",
      message: `GraphQL document could not be parsed: ${(e as Error).message}`,
      mockDetails: mock(queryLocation, interaction.operation.document),
      specDetails: { location: "[root]", value: undefined },
      type: "error",
    });
    return { results };
  }

  // R2
  let operation;
  try {
    operation = selectOperation(document, interaction.operation.operationName);
  } catch (e) {
    if (!(e instanceof ProjectionError)) throw e;
    results.push({
      code: "request.graphql.operation.unknown",
      message: e.message,
      mockDetails: mock(
        `[root].interactions[${index}].request.body.content.operationName`,
        interaction.operation.operationName,
      ),
      specDetails: { location: "[root]", value: undefined },
      type: "error",
    });
    return { results };
  }

  // R3-R7, R9
  const validationErrors = validate(schema, document);
  for (const error of validationErrors) {
    results.push({
      code: codeForValidationError(error),
      message: `${error.message}${position(error)}`,
      mockDetails: mock(queryLocation, interaction.operation.document),
      specDetails: { location: specLocation(error), value: undefined },
      type: "error",
    });
  }

  // R8 — validate() never sees runtime values, so variables need their own pass
  for (const definition of operation.variableDefinitions ?? []) {
    const name = definition.variable.name.value;
    const type = typeFromAST(schema, definition.type);
    if (!type || !isInputType(type)) continue; // an unknown variable type is already an R9 error

    const supplied = Object.prototype.hasOwnProperty.call(
      interaction.operation.variables,
      name,
    );
    const required =
      definition.type.kind === Kind.NON_NULL_TYPE && !definition.defaultValue;

    if (!supplied) {
      if (required) {
        results.push({
          code: "request.graphql.variables.incompatible",
          message: `Variable "$${name}" is required but was not provided`,
          mockDetails: mock(
            `[root].interactions[${index}].request.body.content.variables`,
            interaction.operation.variables,
          ),
          specDetails: { location: "[root]", value: undefined },
          type: "error",
        });
      }
      continue;
    }

    const errors: string[] = [];
    coerceInputValue(
      interaction.operation.variables[name],
      type,
      (_path, _invalidValue, error) => errors.push(error.message),
    );

    for (const message of errors) {
      results.push({
        code: "request.graphql.variables.incompatible",
        message: `Variable "$${name}" is incompatible with its declared type: ${message}`,
        mockDetails: mock(
          `[root].interactions[${index}].request.body.content.variables.${name}`,
          interaction.operation.variables[name],
        ),
        specDetails: { location: "[root]", value: undefined },
        type: "error",
      });
    }
  }

  const failed = results.some((r) => r.type === "error");
  return { results, document: failed ? undefined : document };
};
