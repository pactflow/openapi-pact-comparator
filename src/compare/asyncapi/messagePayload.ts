import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import { get } from "lodash-es";

import type { Message } from "#documents/asyncapi";
import { binaryFormatOf, unwrapMultiFormatSchema } from "#documents/asyncapi";
import type { BinaryPayload } from "#documents/binary";
import type { Result } from "#results/index";
import {
  baseMockDetails,
  formatInstancePath,
  formatMessage,
  formatSchemaPath,
} from "#results/index";
import { transformReceivedSchema } from "#transform/index";
import { bodyValidationStatus } from "#utils/body";
import { splitPath } from "#utils/schema";
import { getValidateFunction } from "#utils/validation";

import { compareBinaryStructure } from "./binary/index";

// Candidate names for a message, in Drift's precedence: the type it declares
// explicitly (a `proto` content type parameter, or the payload's
// `x-drift-proto-message`), its key in the spec (the last segment of its path,
// when it has one), then the names it declares itself.
const messageNames = (message: Message, messagePath: string): string[] =>
  [
    /;\s*proto\s*=\s*([^;\s]+)/i.exec(message.contentType ?? "")?.[1],
    (message.payload as { "x-drift-proto-message"?: unknown } | undefined)?.[
      "x-drift-proto-message"
    ],
    /\.([^.[\]]+)$/.exec(messagePath)?.[1],
    message.name,
    message.title,
    message.messageId,
  ].filter((n): n is string => typeof n === "string");

const FORMAT_NAMES = { avro: "Avro", protobuf: "Protobuf" };

// The consumer's payload and the provider's schema must be the same binary
// format: an Avro or Protobuf payload can't satisfy a message declared as
// anything else, and nor can a plain payload satisfy an Avro or Protobuf one.
const checkFormat = (
  message: Message,
  content: { payload: unknown; contentType?: string; binary?: BinaryPayload },
  interactionContext: { description?: string; providerState?: string },
  contentLocation: string,
  messagePath: string,
): Result | undefined => {
  const consumer = content.binary?.format;
  const provider = binaryFormatOf(message.payload);
  if (
    !message.payload ||
    consumer === provider ||
    (!consumer && content.payload === undefined)
  ) {
    return undefined;
  }
  const { schemaFormat } = message.payload as { schemaFormat?: unknown };
  const declared =
    typeof schemaFormat === "string" ? schemaFormat : message.contentType;
  const mine = consumer
    ? FORMAT_NAMES[consumer]
    : (content.contentType ?? "not Avro or Protobuf");
  const theirs = provider
    ? FORMAT_NAMES[provider]
    : (declared ?? "a JSON Schema");
  return {
    code: "message.payload.format.incompatible",
    message: `The consumer's message is ${mine}, but the provider's message is ${theirs}`,
    mockDetails: {
      ...baseMockDetails(interactionContext),
      location: contentLocation,
      value: content.payload,
    },
    specDetails: { location: `${messagePath}.payload`, value: declared },
    type: "error",
  };
};

type PayloadContent = {
  payload: unknown;
  contentType?: string;
  decodeError?: string;
  binary?: BinaryPayload;
};

// Avro and Protobuf payloads are compared in two independent passes (once
// their formats agree), each reporting what it finds: the value pass validates the consumer's decoded
// example against the provider's schema, and the structural pass compares the
// consumer's own schema with the provider's.
export function* compareMessagePayload(
  ajv: Ajv,
  message: Message,
  content: PayloadContent,
  interactionContext: { description?: string; providerState?: string },
  contentLocation: string,
  messagePath: string,
  direction: "request" | "response",
): Iterable<Result> {
  const formatProblem = checkFormat(
    message,
    content,
    interactionContext,
    contentLocation,
    messagePath,
  );
  if (formatProblem) {
    yield formatProblem;
    return;
  }

  yield* comparePayloadValues(
    ajv,
    message,
    content,
    interactionContext,
    contentLocation,
    messagePath,
    direction,
  );
  yield* compareBinaryStructure(
    message,
    content,
    messageNames(message, messagePath),
    interactionContext,
    contentLocation,
    messagePath,
    direction,
  );
}

function* comparePayloadValues(
  ajv: Ajv,
  message: Message,
  content: PayloadContent,
  interactionContext: { description?: string; providerState?: string },
  contentLocation: string,
  messagePath: string,
  direction: "request" | "response",
): Iterable<Result> {
  const status = bodyValidationStatus(content.contentType, content.payload);

  if (status === "warn") {
    yield {
      code: "message.payload.unvalidatable",
      message: `Body with content type '${content.contentType}' is not supported by the spec comparator${content.decodeError ? `: ${content.decodeError}` : ""}`,
      mockDetails: {
        ...baseMockDetails(interactionContext),
        location: contentLocation,
        value: content.payload,
      },
      specDetails: {
        location: messagePath,
        value: undefined,
      },
      type: "warning",
    };
    return;
  }

  if (status === "skip") {
    return;
  }

  const unwrapped = message.payload
    ? unwrapMultiFormatSchema(
        message.payload,
        messageNames(message, messagePath),
      )
    : undefined;

  if (unwrapped?.status === "unsupported") {
    yield {
      code: "message.payload.unvalidatable",
      message: `Schema with format '${unwrapped.schemaFormat}' is not supported by the spec comparator${unwrapped.reason ? `: ${unwrapped.reason}` : ""}`,
      mockDetails: {
        ...baseMockDetails(interactionContext),
        location: contentLocation,
        value: content.payload,
      },
      specDetails: {
        location: `${messagePath}.payload.schemaFormat`,
        value: unwrapped.schemaFormat,
      },
      type: "warning",
    };
    return;
  }

  const payloadSchema = unwrapped?.schema;
  if (!payloadSchema) {
    if (content.payload !== undefined) {
      yield {
        code: "message.payload.unknown",
        message: "No schema found for message payload",
        mockDetails: {
          ...baseMockDetails(interactionContext),
          location: contentLocation,
          value: content.payload,
        },
        specDetails: {
          location: messagePath,
          value: undefined,
        },
        type: "warning",
      };
    }
    return;
  }

  const schemaPath = `${messagePath}.payload${unwrapped.path}`;
  const schemaId = `${schemaPath}#${direction}`;
  const validate = getValidateFunction(ajv, schemaId, () => {
    const rawSchema = structuredClone(payloadSchema) as SchemaObject;
    return direction === "response"
      ? transformReceivedSchema(rawSchema)
      : rawSchema;
  });
  if (!validate(content.payload)) {
    for (const error of validate.errors ?? []) {
      yield {
        code: "message.payload.incompatible",
        message: `Message payload is incompatible with the schema in the spec file: ${formatMessage(error)}`,
        mockDetails: {
          ...baseMockDetails(interactionContext),
          location: `${contentLocation}${formatInstancePath(error)}`,
          value: error.instancePath
            ? get(content.payload, splitPath(error.instancePath))
            : content.payload,
        },
        specDetails: {
          location: `${schemaPath}.${formatSchemaPath(error)}`,
          value: get(validate.schema, splitPath(error.schemaPath)),
        },
        type: "error",
      };
    }
  }
}
