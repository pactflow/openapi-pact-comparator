import { fingerprint } from "#documents/graphql";
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
