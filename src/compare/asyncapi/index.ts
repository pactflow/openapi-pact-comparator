import type Ajv from "ajv/dist/2019";
import type { AsyncAPIDocument, ResolvedMessage } from "#documents/asyncapi";
import { iterateMessages } from "#documents/asyncapi";
import type { AsyncInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import { tryMatchAllMessages } from "./matchMessages";

export function* compareAsyncInteraction(
  ajv: Ajv,
  asyncapi: AsyncAPIDocument | undefined,
  cache: Map<string, ResolvedMessage>,
  interaction: AsyncInteraction,
  index: number,
): Iterable<Result> {
  if (!asyncapi) {
    yield {
      code: "message.spec.missing",
      message: "No AsyncAPI document provided to validate async interaction",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}]`,
        value: interaction.description,
      },
      specDetails: { location: "[root]", value: undefined },
      type: "error",
    };
    return;
  }

  if (!interaction.asyncapiReferences) {
    yield {
      code: "message.references.missing",
      message:
        "Async interaction has no AsyncAPI references in comments.references.AsyncAPI",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].comments.references.AsyncAPI`,
        value: undefined,
      },
      specDetails: { location: "[root]", value: undefined },
      type: "error",
    };
    return;
  }

  const { operationId } = interaction.asyncapiReferences;

  if (!asyncapi.operations?.[operationId]) {
    yield {
      code: "message.operation.unknown",
      message: `Operation not defined in AsyncAPI spec: ${operationId}`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].comments.references.AsyncAPI.operationId`,
        value: operationId,
      },
      specDetails: { location: "[root].operations", value: undefined },
      type: "error",
    };
    return;
  }

  yield* tryMatchAllMessages(
    ajv,
    asyncapi,
    iterateMessages(asyncapi, operationId, cache),
    interaction.payload,
    interaction.contentType,
    interaction.metadata,
    interaction.description ?? null,
    interaction.providerState || "[none]",
    `[root].interactions[${index}].contents.content`,
    `[root].interactions[${index}].metadata`,
    `[root].operations.${operationId}.messages`,
    "response",
    {
      ...baseMockDetails(interaction),
      location: `[root].interactions[${index}]`,
      value: interaction.description,
    },
  );
}
