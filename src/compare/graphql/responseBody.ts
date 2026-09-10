import type Ajv from "ajv/dist/2019";
import type { DocumentNode, GraphQLSchema } from "graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import {
  baseMockDetails,
  formatInstancePath,
  formatMessage,
} from "#results/index";
import { graphqlResponseSchema } from "#transform/graphqlResponseSchema";

export const compareResponseBody = (
  ajv: Ajv,
  schema: GraphQLSchema,
  document: DocumentNode,
  interaction: GraphqlHttpInteraction,
  index: number,
): Result[] => {
  const results: Result[] = [];
  const bodyLocation = `[root].interactions[${index}].response.body.content`;
  const mock = (location: string, value: unknown) => ({
    ...baseMockDetails(interaction),
    location,
    value,
  });

  // U4 — a transport failure says nothing about schema compatibility
  if (interaction.response.status >= 400) {
    return [
      {
        code: "response.graphql.status.unexpected",
        message: `Response status ${interaction.response.status} is a transport failure; the GraphQL response body was not checked`,
        mockDetails: mock(
          `[root].interactions[${index}].response.status`,
          interaction.response.status,
        ),
        specDetails: { location: "[root]", value: undefined },
        type: "warning",
      },
    ];
  }

  const body = interaction.response.body;
  if (body === undefined || body === null) return results;

  const envelope = body as Record<string, unknown>;

  // U1 — error payloads are not described by the schema
  if (envelope.errors !== undefined) {
    return [
      {
        code: "response.graphql.errors.unvalidatable",
        message:
          "Response contains a GraphQL errors key; error payloads are not described by the schema, so data was not checked",
        mockDetails: mock(`${bodyLocation}.errors`, envelope.errors),
        specDetails: { location: "[root]", value: undefined },
        type: "warning",
      },
    ];
  }

  // U2
  if (envelope.data === null) {
    return [
      {
        code: "response.graphql.data.null",
        message: "Response data is null, so no fields could be checked",
        mockDetails: mock(`${bodyLocation}.data`, null),
        specDetails: { location: "[root]", value: undefined },
        type: "warning",
      },
    ];
  }

  const { schema: responseSchema, unvalidatableScalars } =
    graphqlResponseSchema(schema, document);

  // U3
  for (const path of unvalidatableScalars) {
    results.push({
      code: "response.graphql.scalar.unvalidatable",
      message: `Custom scalar at ${path} cannot be validated; any value is accepted`,
      mockDetails: mock(`${bodyLocation}.${path}`, undefined),
      specDetails: { location: "[root]", value: undefined },
      type: "warning",
    });
  }

  const validate = ajv.compile(responseSchema);
  if (validate(body)) return results;

  for (const error of validate.errors ?? []) {
    results.push({
      code: "response.graphql.body.incompatible",
      message: `Response body is incompatible with the GraphQL schema: ${formatMessage(error)}`,
      mockDetails: mock(
        `${bodyLocation}${formatInstancePath(error)}`,
        interaction.response.body,
      ),
      specDetails: {
        location: `[root].${rootTypeName(schema, document)}`,
        value: undefined,
      },
      type: "error",
    });
  }

  return results;
};

const rootTypeName = (
  schema: GraphQLSchema,
  document: DocumentNode,
): string => {
  const operation = document.definitions.find(
    (d): d is import("graphql").OperationDefinitionNode =>
      d.kind === "OperationDefinition",
  );
  const type =
    operation?.operation === "mutation"
      ? schema.getMutationType()
      : operation?.operation === "subscription"
        ? schema.getSubscriptionType()
        : schema.getQueryType();
  return type?.name ?? "Query";
};
