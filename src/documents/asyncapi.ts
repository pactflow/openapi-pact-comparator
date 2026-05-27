// Minimal structural types for AsyncAPI 3.x documents. Unlike OpenAPI, there is
// no stable `asyncapi-types` package to import, and the comparator only needs
// the operations/channels/messages subset of the spec. A full parser library
// would add a heavy dependency while providing validation we deliberately defer
// (see the FIXME in `parse()`), so we define only what we need here.
import { dereferenceDoc } from "#utils/schema";

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
  messageId?: string;
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

export interface ResolvedMessage {
  message: Message;
  path: string;
}

export const resolveMessage = (
  doc: AsyncAPIDocument,
  operationId: string,
  messageId: string,
  cache: Map<string, ResolvedMessage | null>,
): ResolvedMessage | null => {
  const cacheKey = JSON.stringify([operationId, messageId]);
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const operation = doc.operations?.[operationId];
  if (!operation) {
    cache.set(cacheKey, null);
    return null;
  }

  for (const [i, ref] of (Array.isArray(operation.messages)
    ? operation.messages
    : []
  ).entries()) {
    if (ref == null || typeof ref !== "object") continue;
    if (isRef(ref)) {
      const message = dereferenceDoc(ref, doc) as Message | undefined;
      if (!message) continue;
      const refKey = ref.$ref.split("/").pop() ?? "";
      if (message.messageId === messageId || refKey === messageId) {
        const path =
          "[root]." + ref.$ref.replace(/^#\//, "").replace(/\//g, ".");
        const result = { message, path };
        cache.set(cacheKey, result);
        return result;
      }
      continue;
    }

    const inlineMessage = ref as Message;
    if (inlineMessage.messageId === messageId) {
      const path = `[root].operations.${operationId}.messages[${i}]`;
      const result = { message: inlineMessage, path };
      cache.set(cacheKey, result);
      return result;
    }
  }

  cache.set(cacheKey, null);
  return null;
};

export const resolveReplyMessage = (
  doc: AsyncAPIDocument,
  operationId: string,
  messageId: string,
  cache: Map<string, ResolvedMessage | null>,
): ResolvedMessage | null => {
  const cacheKey = JSON.stringify(["reply", operationId, messageId]);
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const operation = doc.operations?.[operationId];
  if (!operation?.reply) {
    cache.set(cacheKey, null);
    return null;
  }

  for (const [i, ref] of (Array.isArray(operation.reply.messages)
    ? operation.reply.messages
    : []
  ).entries()) {
    if (ref == null || typeof ref !== "object") continue;
    if (isRef(ref)) {
      const message = dereferenceDoc(ref, doc) as Message | undefined;
      if (!message) continue;
      const refKey = ref.$ref.split("/").pop() ?? "";
      if (message.messageId === messageId || refKey === messageId) {
        const path =
          "[root]." + ref.$ref.replace(/^#\//, "").replace(/\//g, ".");
        const result = { message, path };
        cache.set(cacheKey, result);
        return result;
      }
    } else {
      const msg = ref as Message;
      if (msg.messageId === messageId) {
        const path = `[root].operations.${operationId}.reply.messages[${i}]`;
        const result = { message: msg, path };
        cache.set(cacheKey, result);
        return result;
      }
    }
  }

  cache.set(cacheKey, null);
  return null;
};

export function* iterateMessages(
  doc: AsyncAPIDocument,
  operationId: string,
  cache: Map<string, ResolvedMessage>,
): Generator<ResolvedMessage> {
  const operation = doc.operations?.[operationId];
  if (!operation) return;

  const messages = Array.isArray(operation.messages) ? operation.messages : [];
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
      const path = "[root]." + ref.$ref.replace(/^#\//, "").replace(/\//g, ".");
      const result: ResolvedMessage = { message, path };
      cache.set(ref.$ref, result);
      yield result;
    } else {
      yield {
        message: ref as Message,
        path: `[root].operations.${operationId}.messages[${i}]`,
      };
    }
  }
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
      const path = "[root]." + ref.$ref.replace(/^#\//, "").replace(/\//g, ".");
      const result: ResolvedMessage = { message, path };
      cache.set(ref.$ref, result);
      yield result;
    } else {
      yield {
        message: ref as Message,
        path: `[root].operations.${operationId}.reply.messages[${i}]`,
      };
    }
  }
}
