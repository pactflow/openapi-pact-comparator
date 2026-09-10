import type Ajv from "ajv/dist/2019";
import { type GraphQLSchema, parse as parseDocument, validate } from "graphql";
import { ProjectionError, selectOperation } from "#documents/graphqlProjection";
import type { GraphqlMessageInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import {
  baseMockDetails,
  formatInstancePath,
  formatMessage,
} from "#results/index";
import { graphqlResponseSchema } from "#transform/graphqlResponseSchema";

export function* compareGraphqlMessageInteraction(
  ajv: Ajv,
  schema: GraphQLSchema,
  interaction: GraphqlMessageInteraction,
  index: number,
): Iterable<Result> {
  const documentLocation = `[root].interactions[${index}].pluginConfiguration.graphql.query_document`;
  const payloadLocation = `[root].interactions[${index}].contents.content.data`;
  const mock = (location: string, value: unknown) => ({
    ...baseMockDetails(interaction),
    location,
    value,
  });

  let document;
  try {
    document = parseDocument(interaction.operation.document);
    selectOperation(document, interaction.operation.operationName);
  } catch (e) {
    yield {
      code:
        e instanceof ProjectionError
          ? "request.graphql.operation.unknown"
          : "request.graphql.document.invalid",
      message: (e as Error).message,
      mockDetails: mock(documentLocation, interaction.operation.document),
      specDetails: { location: "[root]", value: undefined },
      type: "error",
    };
    return;
  }

  const validationErrors = validate(schema, document);
  if (validationErrors.length) {
    for (const error of validationErrors) {
      yield {
        code: /^Cannot query field /.test(error.message)
          ? "request.graphql.field.unknown"
          : "request.graphql.incompatible",
        message: error.message,
        mockDetails: mock(documentLocation, interaction.operation.document),
        specDetails: { location: "[root].Subscription", value: undefined },
        type: "error",
      };
    }
    return;
  }

  if (interaction.payload === undefined) return;

  const { schema: responseSchema, unvalidatableScalars } =
    graphqlResponseSchema(
      schema,
      document,
      interaction.operation.operationName,
    );

  for (const path of unvalidatableScalars) {
    yield {
      code: "response.graphql.scalar.unvalidatable",
      message: `Custom scalar at ${path} cannot be validated; any value is accepted`,
      mockDetails: mock(`${payloadLocation}`, undefined),
      specDetails: { location: "[root].Subscription", value: undefined },
      type: "warning",
    };
  }

  const validateFn = ajv.compile(responseSchema);
  if (validateFn(interaction.payload)) {
    yield {
      code: "graphql.operation.matched",
      message: `Matched GraphQL subscription ${interaction.operation.operationName ?? "(anonymous)"}`,
      specDetails: { location: "[root].Subscription", value: undefined },
      type: "info",
    };
    return;
  }

  for (const error of validateFn.errors ?? []) {
    yield {
      code: "message.graphql.payload.incompatible",
      message: `Message payload is incompatible with the GraphQL schema: ${formatMessage(error)}`,
      mockDetails: mock(
        `${payloadLocation}${formatInstancePath(error)}`,
        interaction.payload,
      ),
      specDetails: { location: "[root].Subscription", value: undefined },
      type: "error",
    };
  }
}
