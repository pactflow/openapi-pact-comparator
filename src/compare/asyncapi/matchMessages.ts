import type Ajv from "ajv/dist/2019";
import type {
  AsyncAPIDocument,
  Message,
  ResolvedMessage,
} from "#documents/asyncapi";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import { resolveSchemaRefs } from "#utils/schema";
import { compareMessageHeaders } from "./messageHeaders";
import { compareMessagePayload } from "./messagePayload";

type InteractionContext = {
  description?: string;
  providerState?: string;
  asyncapiReferences?: { operationId: string };
};

export function checkAsyncapiPreamble(
  asyncapi: AsyncAPIDocument | undefined,
  interaction: InteractionContext,
  index: number,
  interactionKind: string,
):
  | { ok: true; asyncapi: AsyncAPIDocument; operationId: string }
  | { ok: false; result: Result } {
  if (!asyncapi) {
    return {
      ok: false,
      result: {
        code: "message.spec.missing",
        message: `No AsyncAPI document provided to validate ${interactionKind} interaction`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}]`,
          value: interaction.description,
        },
        specDetails: { location: "[root]", value: undefined },
        type: "error",
      },
    };
  }

  if (!interaction.asyncapiReferences) {
    return {
      ok: false,
      result: {
        code: "message.references.missing",
        message: `${interactionKind.charAt(0).toUpperCase()}${interactionKind.slice(1)} interaction has no AsyncAPI references in comments.references.AsyncAPI`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].comments.references.AsyncAPI`,
          value: undefined,
        },
        specDetails: { location: "[root]", value: undefined },
        type: "error",
      },
    };
  }

  const { operationId } = interaction.asyncapiReferences;

  if (!asyncapi.operations?.[operationId]) {
    return {
      ok: false,
      result: {
        code: "message.operation.unknown",
        message: `Operation not defined in AsyncAPI spec: ${operationId}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].comments.references.AsyncAPI.operationId`,
          value: operationId,
        },
        specDetails: { location: "[root].operations", value: undefined },
        type: "error",
      },
    };
  }

  return { ok: true, asyncapi, operationId };
}

type MessageContent = {
  payload: unknown;
  contentType?: string;
  metadata?: Record<string, string>;
};

type MessageLocations = {
  payload: string;
  headers: string;
  spec: string;
};

export function* tryMatchAllMessages(
  ajv: Ajv,
  asyncapi: AsyncAPIDocument,
  candidates: Iterable<ResolvedMessage>,
  content: MessageContent,
  interactionContext: { description?: string; providerState?: string },
  locations: MessageLocations,
  direction: "request" | "response",
  noMatchMockDetails: NonNullable<Result["mockDetails"]>,
): Generator<Result> {
  const allCauses: Result[] = [];
  const description = interactionContext.description ?? null;
  const providerState = interactionContext.providerState || "[none]";

  for (const candidate of candidates) {
    const message: Message = {
      ...candidate.message,
      payload: candidate.message.payload
        ? (resolveSchemaRefs(candidate.message.payload, asyncapi) as object)
        : undefined,
      headers: candidate.message.headers
        ? (resolveSchemaRefs(candidate.message.headers, asyncapi) as object)
        : undefined,
    };

    const allResults: Result[] = [
      ...compareMessagePayload(
        ajv,
        message,
        content.payload,
        content.contentType,
        description,
        providerState,
        locations.payload,
        candidate.path,
        direction,
      ),
      ...compareMessageHeaders(
        ajv,
        message,
        content.metadata,
        description,
        providerState,
        locations.headers,
        candidate.path,
        direction,
      ),
    ];

    const blockingErrors = allResults.filter((r) => r.type === "error");

    if (blockingErrors.length === 0) {
      yield* allResults.filter((r) => r.type !== "error");
      yield {
        code: "message.matched",
        message: `Matched message at ${candidate.path}`,
        specDetails: { location: candidate.path, value: candidate.message },
        type: "info",
      };
      return;
    }

    allCauses.push(...blockingErrors);
  }

  yield {
    code: "message.no.match",
    message: "No message in the operation matched the interaction",
    mockDetails: noMatchMockDetails,
    specDetails: { location: locations.spec, value: undefined },
    type: "error",
    causes: allCauses,
  };
}
