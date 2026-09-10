import { type GraphQLSchema, isObjectType } from "graphql";
import { fingerprint, parse as parseSchemaSdl } from "#documents/graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";

export interface ProvenanceState {
  reported: boolean;
  providerFingerprint?: string;
}

/**
 * S1: warn once per pact when the consumer was built against a different
 * schema. S3: this may never fail a comparison, so an embedded schema that
 * cannot be parsed is silently ignored rather than reported.
 */
export function* checkSchemaProvenance(
  state: ProvenanceState,
  providerSdl: string,
  interaction: GraphqlHttpInteraction,
  index: number,
): Iterable<Result> {
  if (state.reported) return;

  const embedded = interaction.plugin?.inlineSchemaSdl;
  if (!embedded) return;

  const consumerFingerprint = fingerprint(embedded);
  if (!consumerFingerprint) return;

  state.providerFingerprint ??= fingerprint(providerSdl);
  if (!state.providerFingerprint) return;
  if (state.providerFingerprint === consumerFingerprint) return;

  state.reported = true;
  yield {
    code: "graphql.schema.mismatch",
    message:
      "This consumer was built against a different version of the provider's GraphQL schema. This is not itself a compatibility failure, but it explains any that follow.",
    mockDetails: {
      ...baseMockDetails(interaction),
      location: `[root].interactions[${index}].pluginConfiguration.graphql.inline_schema`,
      value: consumerFingerprint,
    },
    specDetails: { location: "[root]", value: state.providerFingerprint },
    type: "warning",
  };
}

/**
 * S2: when a request-side error names a field and a type, and the consumer's
 * embedded schema had that field while the provider's does not, say so. This
 * only ever adds a `causes` entry to an existing result (S3).
 */
export const explainWithEmbeddedSchema = (
  results: Result[],
  embeddedSdl: string | undefined,
  providerSchema: GraphQLSchema,
): Result[] => {
  if (!embeddedSdl) return results;

  let embedded: GraphQLSchema;
  try {
    embedded = parseSchemaSdl(embeddedSdl);
  } catch {
    return results; // diagnostic input may never break a comparison
  }

  return results.map((result) => {
    const match = /Cannot query field "([^"]+)" on type "([^"]+)"/.exec(
      result.message,
    );
    if (!match) return result;

    const [, fieldName, typeName] = match;

    const embeddedType = embedded.getType(typeName);
    const providerType = providerSchema.getType(typeName);
    if (!isObjectType(embeddedType)) return result;
    if (!(fieldName in embeddedType.getFields())) return result;
    if (isObjectType(providerType) && fieldName in providerType.getFields()) {
      return result;
    }

    return {
      ...result,
      causes: [
        ...(result.causes ?? []),
        {
          code: "graphql.schema.mismatch" as const,
          message: `${typeName}.${fieldName} exists in the schema this consumer was built against and is absent from the provider contract`,
          type: "warning" as const,
        },
      ],
    };
  });
};
