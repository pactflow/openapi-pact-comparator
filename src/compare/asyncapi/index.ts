import type Ajv from "ajv/dist/2019";

import type { AsyncAPIDocument, ResolvedMessage } from "#documents/asyncapi";
import { resolveMessage } from "#documents/asyncapi";
import type { AsyncInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";

import { compareMessageHeaders } from "./messageHeaders";
import { compareMessagePayload } from "./messagePayload";

export function* compareAsyncInteraction(
  ajv: Ajv,
  asyncapi: AsyncAPIDocument | undefined,
  cache: Map<string, ResolvedMessage | null>,
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

  const { operationId, messageId } = interaction.asyncapiReferences;

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

  const resolved = resolveMessage(asyncapi, operationId, messageId, cache);
  if (!resolved) {
    yield {
      code: "message.id.unknown",
      message: `Message not defined in AsyncAPI spec: ${messageId}`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].comments.references.AsyncAPI.messageId`,
        value: messageId,
      },
      specDetails: {
        location: `[root].operations.${operationId}.messages`,
        value: asyncapi.operations[operationId]?.messages,
      },
      type: "error",
    };
    return;
  }

  yield* compareMessagePayload(
    ajv,
    resolved.message,
    interaction,
    index,
    resolved.path,
  );
  yield* compareMessageHeaders(
    ajv,
    resolved.message,
    interaction,
    index,
    resolved.path,
  );
}
