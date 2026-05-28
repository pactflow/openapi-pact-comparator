import type Ajv from "ajv/dist/2019";
import type {
  AsyncAPIDocument,
  Message,
  ResolvedMessage,
} from "#documents/asyncapi";
import type { Result } from "#results/index";
import { resolveSchemaRefs } from "#utils/schema";
import { compareMessageHeaders } from "./messageHeaders";
import { compareMessagePayload } from "./messagePayload";

export function* tryMatchAllMessages(
  ajv: Ajv,
  asyncapi: AsyncAPIDocument,
  candidates: Iterable<ResolvedMessage>,
  payload: unknown,
  contentType: string | undefined,
  metadata: Record<string, string> | undefined,
  description: string | null,
  providerState: string,
  payloadLocation: string,
  headersLocation: string,
  specLocation: string,
  direction: "request" | "response",
  noMatchMockDetails: NonNullable<Result["mockDetails"]>,
): Generator<Result> {
  const allCauses: Result[] = [];

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
        payload,
        contentType,
        description,
        providerState,
        payloadLocation,
        candidate.path,
        direction,
      ),
      ...compareMessageHeaders(
        ajv,
        message,
        metadata,
        description,
        providerState,
        headersLocation,
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
    specDetails: { location: specLocation, value: undefined },
    type: "error",
    causes: allCauses,
  };
}
