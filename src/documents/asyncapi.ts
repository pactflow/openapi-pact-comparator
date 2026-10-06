// Minimal structural types for AsyncAPI 3.x documents. Unlike OpenAPI, there is
// no stable `asyncapi-types` package to import, and the comparator only needs
// the operations/channels/messages subset of the spec. A full parser library
// would add a heavy dependency while providing validation we deliberately defer
// (see the FIXME in `parse()`), so we define only what we need here.
import { dereferenceDoc, lastRefInChain } from "#utils/schema";

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

export interface Channel {
  messages?: Record<string, Message | Ref>;
}

export interface OperationReply {
  channel?: Ref;
  messages?: Array<Ref | Message>;
}

export interface Operation {
  action: "send" | "receive";
  channel: Ref;
  messages?: Array<Ref | Message>;
  reply?: OperationReply;
}

export interface Message {
  payload?: object;
  headers?: object;
  contentType?: string;
}

export interface Ref {
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
// can be validated directly. The version parameter is deliberately ignored.
const JSON_SCHEMA_FORMATS = [
  "application/vnd.aai.asyncapi",
  "application/vnd.aai.asyncapi+json",
  "application/vnd.aai.asyncapi+yaml",
  "application/schema+json",
  "application/schema+yaml",
];

export type UnwrappedSchema =
  | { status: "schema"; schema: object | undefined; path: string }
  | { status: "unsupported"; schemaFormat: string };

// A payload or headers value may be a Multi Format Schema Object
// (`{ schemaFormat, schema }`) rather than a Schema Object. Ajv ignores the
// unknown keywords and would accept anything, so it must be unwrapped first.
// `path` is the suffix to append to the spec location of the original value.
export const unwrapMultiFormatSchema = (value: object): UnwrappedSchema => {
  const { schemaFormat, schema } = value as {
    schemaFormat?: unknown;
    schema?: unknown;
  };
  if (typeof schemaFormat !== "string") {
    return { status: "schema", schema: value, path: "" };
  }

  const mediaType = schemaFormat.split(";")[0].trim().toLowerCase();
  if (!JSON_SCHEMA_FORMATS.includes(mediaType)) {
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
}

function* iterateMessageList(
  messages: Array<Ref | Message>,
  inlinePathBase: string,
  cache: Map<string, ResolvedMessage>,
  doc: AsyncAPIDocument,
): Generator<ResolvedMessage> {
  for (const [i, ref] of messages.entries()) {
    if (ref == null || typeof ref !== "object") continue;
    if (isRef(ref)) {
      const cached = cache.get(ref.$ref);
      if (cached) {
        yield cached;
        continue;
      }
      const message = dereferenceDoc(ref, doc) as Message | undefined;
      if (!message) continue;
      const finalRef = lastRefInChain(ref, doc) ?? ref.$ref;
      const path = "[root]." + finalRef.replace(/^#\//, "").replace(/\//g, ".");
      const result: ResolvedMessage = { message, path };
      cache.set(ref.$ref, result);
      yield result;
    } else {
      yield { message: ref as Message, path: `${inlinePathBase}[${i}]` };
    }
  }
}

export function* iterateMessages(
  doc: AsyncAPIDocument,
  operationId: string,
  cache: Map<string, ResolvedMessage>,
): Generator<ResolvedMessage> {
  const operation = doc.operations?.[operationId];
  if (!operation) return;

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
  if (!operation?.reply) return;

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
