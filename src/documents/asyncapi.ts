// Minimal structural types for AsyncAPI 3.x documents. Unlike OpenAPI, there is
// no stable `asyncapi-types` package to import, and the comparator only needs
// the operations/channels/messages subset of the spec. A full parser library
// would add a heavy dependency while providing validation we deliberately defer
// (see the FIXME in `parse()`), so we define only what we need here.
import { dereferenceDoc, lastRefInChain } from "#utils/schema";

import { AVRO_SCHEMA_FORMATS, avroToJsonSchema } from "./avro";
import {
  findProtoMessage,
  PROTOBUF_SCHEMA_FORMATS,
  protobufToJsonSchema,
} from "./protobuf";

export interface AsyncAPIDocument {
  asyncapi: string;
  info: { title: string; version: string };
  channels?: Record<string, Channel>;
  operations?: Record<string, Operation>;
  components?: {
    messages?: Record<string, Message>;
    schemas?: Record<string, object>;
  };
}

interface Channel {
  messages?: Record<string, Message | Ref>;
}

interface OperationReply {
  channel?: Ref;
  messages?: Array<Ref | Message>;
}

interface Operation {
  action: "send" | "receive";
  channel: Ref;
  messages?: Array<Ref | Message>;
  reply?: OperationReply;
}

export interface Message {
  payload?: object;
  headers?: object;
  contentType?: string;
  name?: string;
  title?: string;
  messageId?: string;
}

interface Ref {
  $ref: string;
}

const isRef = (value: Ref | Message): value is Ref =>
  typeof value === "object" &&
  value !== null &&
  "$ref" in value &&
  typeof value.$ref === "string";

export class ParserError extends Error {
  constructor() {
    super("Malformed AsyncAPI file");
  }
}

export const parse = (doc: AsyncAPIDocument): void => {
  if (doc == null || typeof doc !== "object") {
    throw new ParserError();
  }
  if (
    !Object.hasOwn(doc, "asyncapi") ||
    typeof doc.asyncapi !== "string" ||
    !doc.asyncapi.startsWith("3.")
  ) {
    throw new ParserError();
  }
  // FIXME: ideally, we validate the full document here
};

// Multi Format Schema Object formats that are (supersets of) JSON Schema and
// can be validated directly.
const JSON_SCHEMA_FORMATS = [
  "application/vnd.aai.asyncapi",
  "application/vnd.aai.asyncapi+json",
  "application/vnd.aai.asyncapi+yaml",
  "application/schema+json",
  "application/schema+yaml",
];
const JSON_SCHEMA_MEDIA_TYPES = [
  "application/schema+json",
  "application/schema+yaml",
];
const SUPPORTED_JSON_SCHEMA_VERSIONS = ["draft-07", "draft-2019-09"];

export type UnwrappedSchema =
  | { status: "schema"; schema: object | undefined; path: string }
  | { status: "unsupported"; schemaFormat: string; reason?: string };

const isDict = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Avro and Protobuf schemas are converted to JSON Schema on demand, when a Pact
// interaction first needs them, and memoised against the (stable) value.
const conversions = new WeakMap<object, UnwrappedSchema>();

const convertToJsonSchema = (
  schemaFormat: string,
  mediaType: string,
  schema: unknown,
  names: string[],
): UnwrappedSchema => {
  const unsupported = (reason: string): UnwrappedSchema => ({
    status: "unsupported",
    schemaFormat,
    reason,
  });
  const isAvro = AVRO_SCHEMA_FORMATS.includes(mediaType);
  const kind = isAvro ? "Avro" : "Protobuf";

  if (
    isAvro
      ? !isDict(schema) && typeof schema !== "string"
      : typeof schema !== "string"
  ) {
    return unsupported(
      `no ${kind} schema available (missing, or an unresolvable $ref)`,
    );
  }

  try {
    if (isAvro) {
      return {
        status: "schema",
        schema: avroToJsonSchema(schema),
        path: ".schema",
      };
    }
    const message = findProtoMessage(schema as string, names);
    return message
      ? {
          status: "schema",
          schema: protobufToJsonSchema(message),
          path: ".schema",
        }
      : unsupported(
          `cannot choose a Protobuf message for ${names.map((n) => `'${n}'`).join(", ") || "this message"}`,
        );
  } catch (e) {
    return unsupported(`invalid ${kind} schema: ${(e as Error).message}`);
  }
};

// A payload or headers value may be a Multi Format Schema Object
// (`{ schemaFormat, schema }`) rather than a Schema Object. Ajv ignores the
// unknown keywords and would accept anything, so it must be unwrapped first.
// `path` is the suffix to append to the spec location of the original value.
// `names` are candidate message names, used to choose a Protobuf message.
export const unwrapMultiFormatSchema = (
  value: object,
  names: string[] = [],
): UnwrappedSchema => {
  const { schemaFormat, schema } = value as {
    schemaFormat?: unknown;
    schema?: unknown;
  };
  if (typeof schemaFormat !== "string") {
    return { status: "schema", schema: value, path: "" };
  }

  const [rawMediaType, ...parameters] = schemaFormat.split(";");
  const mediaType = rawMediaType.trim().toLowerCase();
  if (
    AVRO_SCHEMA_FORMATS.includes(mediaType) ||
    PROTOBUF_SCHEMA_FORMATS.includes(mediaType)
  ) {
    let converted = conversions.get(value);
    if (!converted) {
      converted = convertToJsonSchema(schemaFormat, mediaType, schema, names);
      conversions.set(value, converted);
    }
    return converted;
  }
  if (!JSON_SCHEMA_FORMATS.includes(mediaType)) {
    return { status: "unsupported", schemaFormat };
  }

  const versions = parameters
    .map((parameter) => parameter.trim().toLowerCase())
    .filter((parameter) => parameter.startsWith("version="))
    .map((parameter) => parameter.slice("version=".length).trim());
  if (
    JSON_SCHEMA_MEDIA_TYPES.includes(mediaType) &&
    (versions.length > 1 ||
      (versions.length === 1 &&
        !SUPPORTED_JSON_SCHEMA_VERSIONS.includes(versions[0])))
  ) {
    return { status: "unsupported", schemaFormat };
  }

  return {
    status: "schema",
    schema: schema !== null && typeof schema === "object" ? schema : undefined,
    path: ".schema",
  };
};

export interface ResolvedMessage {
  message: Message;
  path: string;
  // The message with its schema $refs resolved, filled in on first use. Lives
  // and dies with the cache that holds this entry, so it is per Comparator.
  resolved?: Message;
}

function* iterateMessageList(
  messages: Array<Ref | Message>,
  inlinePathBase: string,
  cache: Map<string, ResolvedMessage>,
  doc: AsyncAPIDocument,
): Generator<ResolvedMessage> {
  for (const [i, ref] of messages.entries()) {
    if (ref == null || typeof ref !== "object") {
      continue;
    }
    if (isRef(ref)) {
      const cached = cache.get(ref.$ref);
      if (cached) {
        yield cached;
        continue;
      }
      const message = dereferenceDoc(ref, doc) as Message | undefined;
      if (!message) {
        continue;
      }
      const finalRef = lastRefInChain(ref, doc) ?? ref.$ref;
      const path = "[root]." + finalRef.replace(/^#\//, "").replace(/\//g, ".");
      const result: ResolvedMessage = { message, path };
      cache.set(ref.$ref, result);
      yield result;
    } else {
      const path = `${inlinePathBase}[${i}]`;
      let result = cache.get(path);
      if (!result) {
        result = { message: ref as Message, path };
        cache.set(path, result);
      }
      yield result;
    }
  }
}

export function* iterateMessages(
  doc: AsyncAPIDocument,
  operationId: string,
  cache: Map<string, ResolvedMessage>,
): Generator<ResolvedMessage> {
  const operation = doc.operations?.[operationId];
  if (!operation) {
    return;
  }

  const messages = Array.isArray(operation.messages) ? operation.messages : [];
  yield* iterateMessageList(
    messages,
    `[root].operations.${operationId}.messages`,
    cache,
    doc,
  );
}

export function* iterateReplyMessages(
  doc: AsyncAPIDocument,
  operationId: string,
  cache: Map<string, ResolvedMessage>,
): Generator<ResolvedMessage> {
  const operation = doc.operations?.[operationId];
  if (!operation?.reply) {
    return;
  }

  const messages = Array.isArray(operation.reply.messages)
    ? operation.reply.messages
    : [];
  yield* iterateMessageList(
    messages,
    `[root].operations.${operationId}.reply.messages`,
    cache,
    doc,
  );
}
