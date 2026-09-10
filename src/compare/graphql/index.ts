import type Ajv from "ajv/dist/2019";
import type { GraphQLSchema } from "graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { compareRequestOperation } from "./requestOperation";
import { compareResponseBody } from "./responseBody";
import {
  type ProvenanceState,
  checkSchemaProvenance,
} from "./schemaProvenance";

export function* compareGraphqlHttpInteraction(
  ajv: Ajv,
  schema: GraphQLSchema,
  providerSdl: string,
  provenance: ProvenanceState,
  interaction: GraphqlHttpInteraction,
  index: number,
): Iterable<Result> {
  yield* checkSchemaProvenance(provenance, providerSdl, interaction, index);

  const request = compareRequestOperation(schema, interaction, index);
  yield* request.results;

  // A request that cannot be satisfied makes the response meaningless: the
  // projection would be derived from an operation the provider cannot serve.
  if (!request.document) return;

  const responseResults = compareResponseBody(
    ajv,
    schema,
    request.document,
    interaction,
    index,
  );
  yield* responseResults;

  if (!responseResults.some((r) => r.type === "error")) {
    yield {
      code: "graphql.operation.matched",
      message: `Matched GraphQL operation ${interaction.operation.operationName ?? "(anonymous)"}`,
      specDetails: { location: "[root]", value: undefined },
      type: "info",
    };
  }
}
