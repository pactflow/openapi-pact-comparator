import type Ajv from "ajv/dist/2019";
import type { AsyncAPIDocument, Message, ResolvedMessage } from "#documents/asyncapi";
import { resolveMessage, resolveReplyMessage } from "#documents/asyncapi";
import type { SyncInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import { resolveSchemaRefs } from "#utils/schema";
import { compareMessageHeaders } from "./messageHeaders";
import { compareMessagePayload } from "./messagePayload";

export function* compareSyncInteraction(
  ajv: Ajv,
  asyncapi: AsyncAPIDocument | undefined,
  cache: Map<string, ResolvedMessage | null>,
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

  const {
    requestOperationId,
    requestMessageId,
    responseOperationId,
    responseMessageId,
  } = interaction.asyncapiReferences;

  // --- Request side ---

  if (!asyncapi.operations?.[requestOperationId]) {
    yield {
      code: "message.operation.unknown",
      message: `Operation not defined in AsyncAPI spec: ${requestOperationId}`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].comments.references.AsyncAPI.requestOperationId`,
        value: requestOperationId,
      },
      specDetails: { location: "[root].operations", value: undefined },
      type: "error",
    };
    return;
  }

  const resolvedRequest = resolveMessage(
    asyncapi,
    requestOperationId,
    requestMessageId,
    cache,
  );
  if (!resolvedRequest) {
    yield {
      code: "message.id.unknown",
      message: `Message not defined in AsyncAPI spec: ${requestMessageId}`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].comments.references.AsyncAPI.requestMessageId`,
        value: requestMessageId,
      },
      specDetails: {
        location: `[root].operations.${requestOperationId}.messages`,
        value: asyncapi.operations[requestOperationId]?.messages,
      },
      type: "error",
    };
    return;
  }

  const requestMessage: Message = {
    ...resolvedRequest.message,
    payload: resolvedRequest.message.payload
      ? (resolveSchemaRefs(resolvedRequest.message.payload, asyncapi) as object)
      : undefined,
    headers: resolvedRequest.message.headers
      ? (resolveSchemaRefs(resolvedRequest.message.headers, asyncapi) as object)
      : undefined,
  };

  yield* compareMessagePayload(
    ajv,
    requestMessage,
    interaction.request.payload,
    interaction.request.contentType,
    interaction.description ?? null,
    interaction.providerState ?? null,
    `[root].interactions[${index}].request.contents.content`,
    resolvedRequest.path,
    "request",
  );
  yield* compareMessageHeaders(
    ajv,
    requestMessage,
    interaction.request.metadata,
    interaction.description ?? null,
    interaction.providerState ?? null,
    `[root].interactions[${index}].request.metadata`,
    resolvedRequest.path,
    "request",
  );

  // --- Response side ---

  for (const [j, response] of interaction.responses.entries()) {
    let resolvedResponse: ResolvedMessage | null = null;
    let responseSpecLocation: string;

    if (responseOperationId) {
      // Two-operation pattern
      if (!asyncapi.operations?.[responseOperationId]) {
        yield {
          code: "message.operation.unknown",
          message: `Operation not defined in AsyncAPI spec: ${responseOperationId}`,
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].comments.references.AsyncAPI.responseOperationId`,
            value: responseOperationId,
          },
          specDetails: { location: "[root].operations", value: undefined },
          type: "error",
        };
        return;
      }
      resolvedResponse = resolveMessage(
        asyncapi,
        responseOperationId,
        responseMessageId,
        cache,
      );
      responseSpecLocation = `[root].operations.${responseOperationId}.messages`;
    } else {
      // Single-operation with reply field
      const operation = asyncapi.operations?.[requestOperationId];
      if (!operation?.reply) {
        yield {
          code: "message.reply.missing",
          message: `Operation "${requestOperationId}" has no reply field in AsyncAPI spec`,
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].comments.references.AsyncAPI`,
            value: requestOperationId,
          },
          specDetails: {
            location: `[root].operations.${requestOperationId}`,
            value: operation,
          },
          type: "error",
        };
        return;
      }
      resolvedResponse = resolveReplyMessage(
        asyncapi,
        requestOperationId,
        responseMessageId,
        cache,
      );
      responseSpecLocation = `[root].operations.${requestOperationId}.reply.messages`;
    }

    if (!resolvedResponse) {
      yield {
        code: responseOperationId ? "message.id.unknown" : "message.reply.id.unknown",
        message: `Message not defined in AsyncAPI spec: ${responseMessageId}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].comments.references.AsyncAPI.responseMessageId`,
          value: responseMessageId,
        },
        specDetails: {
          location: responseSpecLocation,
          value: undefined,
        },
        type: "error",
      };
      return;
    }

    const responseMessage: Message = {
      ...resolvedResponse.message,
      payload: resolvedResponse.message.payload
        ? (resolveSchemaRefs(resolvedResponse.message.payload, asyncapi) as object)
        : undefined,
      headers: resolvedResponse.message.headers
        ? (resolveSchemaRefs(resolvedResponse.message.headers, asyncapi) as object)
        : undefined,
    };

    yield* compareMessagePayload(
      ajv,
      responseMessage,
      response.payload,
      response.contentType,
      interaction.description ?? null,
      interaction.providerState ?? null,
      `[root].interactions[${index}].response[${j}].contents.content`,
      resolvedResponse.path,
      "response",
    );
    yield* compareMessageHeaders(
      ajv,
      responseMessage,
      response.metadata,
      interaction.description ?? null,
      interaction.providerState ?? null,
      `[root].interactions[${index}].response[${j}].metadata`,
      resolvedResponse.path,
      "response",
    );
  }
}
