import type Ajv from "ajv/dist/2019";
import type { AsyncAPIDocument, ResolvedMessage } from "#documents/asyncapi";
import { iterateMessages, iterateReplyMessages } from "#documents/asyncapi";
import type { SyncInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import { tryMatchAllMessages } from "./matchMessages";

export function* compareSyncInteraction(
  ajv: Ajv,
  asyncapi: AsyncAPIDocument | undefined,
  cache: Map<string, ResolvedMessage>,
  interaction: SyncInteraction,
  index: number,
): Iterable<Result> {
  if (!asyncapi) {
    yield {
      code: "message.spec.missing",
      message: "No AsyncAPI document provided to validate sync interaction",
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
        "Sync interaction has no AsyncAPI references in comments.references.AsyncAPI",
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

  // --- Request side ---
  let requestMatched = false;
  for (const result of tryMatchAllMessages(
    ajv,
    asyncapi,
    iterateMessages(asyncapi, operationId, cache),
    interaction.request.payload,
    interaction.request.contentType,
    interaction.request.metadata,
    interaction.description ?? null,
    interaction.providerState || "[none]",
    `[root].interactions[${index}].request.contents.content`,
    `[root].interactions[${index}].request.metadata`,
    `[root].operations.${operationId}.messages`,
    "request",
    {
      ...baseMockDetails(interaction),
      location: `[root].interactions[${index}].comments.references.AsyncAPI.operationId`,
      value: operationId,
    },
  )) {
    yield result;
    if (result.type === "info") requestMatched = true;
  }
  if (!requestMatched) return;

  // --- Response side ---
  const operation = asyncapi.operations[operationId];
  if (!operation?.reply) {
    yield {
      code: "message.reply.missing",
      message: `Operation "${operationId}" has no reply field in AsyncAPI spec`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].comments.references.AsyncAPI`,
        value: operationId,
      },
      specDetails: {
        location: `[root].operations.${operationId}`,
        value: operation,
      },
      type: "error",
    };
    return;
  }

  for (const [j, response] of interaction.responses.entries()) {
    yield* tryMatchAllMessages(
      ajv,
      asyncapi,
      iterateReplyMessages(asyncapi, operationId, cache),
      response.payload,
      response.contentType,
      response.metadata,
      interaction.description ?? null,
      interaction.providerState || "[none]",
      `[root].interactions[${index}].response[${j}].contents.content`,
      `[root].interactions[${index}].response[${j}].metadata`,
      `[root].operations.${operationId}.reply.messages`,
      "response",
      {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].comments.references.AsyncAPI.operationId`,
        value: operationId,
      },
    );
  }
}
