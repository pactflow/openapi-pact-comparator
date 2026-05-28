import type Ajv from "ajv/dist/2019";
import type { AsyncAPIDocument, ResolvedMessage } from "#documents/asyncapi";
import { iterateMessages, iterateReplyMessages } from "#documents/asyncapi";
import type { SyncInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import { checkAsyncapiPreamble, tryMatchAllMessages } from "./matchMessages";

export function* compareSyncInteraction(
  ajv: Ajv,
  asyncapi: AsyncAPIDocument | undefined,
  cache: Map<string, ResolvedMessage>,
  interaction: SyncInteraction,
  index: number,
): Iterable<Result> {
  const preamble = checkAsyncapiPreamble(asyncapi, interaction, index, "sync");
  if (!preamble.ok) {
    yield preamble.result;
    return;
  }
  const { asyncapi: doc, operationId } = preamble;

  const noMatchMockDetails = {
    ...baseMockDetails(interaction),
    location: `[root].interactions[${index}].comments.references.AsyncAPI.operationId`,
    value: operationId,
  };

  // --- Request side ---
  let requestMatched = false;
  for (const result of tryMatchAllMessages(
    ajv,
    doc,
    iterateMessages(doc, operationId, cache),
    interaction.request,
    interaction,
    {
      payload: `[root].interactions[${index}].request.contents.content`,
      headers: `[root].interactions[${index}].request.metadata`,
      spec: `[root].operations.${operationId}.messages`,
    },
    "request",
    noMatchMockDetails,
  )) {
    yield result;
    if (result.code === "message.matched") requestMatched = true;
  }
  if (!requestMatched) return;

  // --- Response side ---
  const operation = doc.operations![operationId];
  const replyMessages = Array.isArray(operation.reply?.messages)
    ? operation.reply.messages
    : [];

  if (!operation.reply) {
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

  if (replyMessages.length === 0) {
    yield {
      code: "message.reply.missing",
      message: `Operation "${operationId}" reply defines no messages in AsyncAPI spec`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].comments.references.AsyncAPI`,
        value: operationId,
      },
      specDetails: {
        location: `[root].operations.${operationId}.reply.messages`,
        value: operation.reply.messages,
      },
      type: "error",
    };
    return;
  }

  if (interaction.responses.length === 0) {
    yield {
      code: "message.response.missing",
      message:
        "Sync interaction defines no responses to validate against the reply",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].response`,
        value: [],
      },
      specDetails: {
        location: `[root].operations.${operationId}.reply.messages`,
        value: replyMessages,
      },
      type: "warning",
    };
    return;
  }

  for (const [j, response] of interaction.responses.entries()) {
    yield* tryMatchAllMessages(
      ajv,
      doc,
      iterateReplyMessages(doc, operationId, cache),
      response,
      interaction,
      {
        payload: `[root].interactions[${index}].response[${j}].contents.content`,
        headers: `[root].interactions[${index}].response[${j}].metadata`,
        spec: `[root].operations.${operationId}.reply.messages`,
      },
      "response",
      noMatchMockDetails,
    );
  }
}
