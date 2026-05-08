import { Static, Type } from "@sinclair/typebox";
import Ajv, { ErrorObject } from "ajv";

// a full schema can be found at https://github.com/pactflow/pact-schemas
// but we don't use that here, because we try to be permissive with input

// HTTP-only schema used for AJV validation of synchronous interactions
export const Interaction = Type.Object({
  _skip: Type.Optional(Type.Boolean()),
  type: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  providerState: Type.Optional(Type.String()),
  request: Type.Object({
    body: Type.Optional(Type.Unknown()),
    headers: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Record(Type.String(), Type.String()),
        Type.Record(Type.String(), Type.Array(Type.String())),
      ]),
    ),
    method: Type.String(),
    path: Type.String(),
    query: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.String(),
        Type.Record(Type.String(), Type.String()),
        Type.Record(Type.String(), Type.Array(Type.String())),
      ]),
    ),
  }),
  response: Type.Object({
    body: Type.Optional(Type.Unknown()),
    headers: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Record(Type.String(), Type.String()),
        Type.Record(Type.String(), Type.Array(Type.String())),
      ]),
    ),
    status: Type.Number(),
  }),
});

export type Interaction = Static<typeof Interaction>;

// Async interaction schema used for AJV validation of "Asynchronous/Messages" interactions
const AsyncMessage = Type.Object({
  type: Type.String(),
  description: Type.Optional(Type.String()),
  providerState: Type.Optional(Type.String()),
  contents: Type.Optional(
    Type.Object({
      content: Type.Optional(Type.Unknown()),
      contentType: Type.Optional(Type.String()),
      encoded: Type.Optional(Type.Union([Type.String(), Type.Boolean()])),
    }),
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
  comments: Type.Optional(
    Type.Object({
      references: Type.Optional(
        Type.Object({
          AsyncAPI: Type.Optional(
            Type.Object({
              messageId: Type.String(),
              operationId: Type.String(),
            }),
          ),
        }),
      ),
    }),
  ),
});

// Permissive pact schema — interactions may be HTTP or async; validation of
// each interaction is performed after classification inside parse().
export const Pact = Type.Object({
  metadata: Type.Optional(
    Type.Object({
      pactSpecification: Type.Optional(
        Type.Object({
          version: Type.String(),
        }),
      ),
      pactSpecificationVersion: Type.Optional(Type.String()),
      "pact-specification": Type.Optional(
        Type.Object({
          version: Type.String(),
        }),
      ),
    }),
  ),
  interactions: Type.Array(Type.Unknown()),
});

export type Pact = Static<typeof Pact>;

// ---------------------------------------------------------------------------
// Parsed interaction types (discriminated union on _kind)
// ---------------------------------------------------------------------------

export interface HttpInteraction {
  _kind: "http";
  description?: string;
  providerState?: string;
  request: {
    body?: unknown;
    headers?: Record<string, string>;
    method: string;
    path: string;
    query?: string | Record<string, string>;
  };
  response: {
    body?: unknown;
    headers?: Record<string, string>;
    status: number;
  };
}

export interface AsyncInteraction {
  _kind: "async";
  description?: string;
  providerState?: string;
  asyncapiReferences?: { messageId: string; operationId: string };
  payload: unknown;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface SkippedInteraction {
  _kind: "skip";
}

export type ParsedInteraction =
  | HttpInteraction
  | AsyncInteraction
  | SkippedInteraction;

export interface ParsedPact {
  metadata?: Pact["metadata"];
  interactions: ParsedInteraction[];
}

// Internal shape of a raw pact interaction before classification
interface RawInteraction {
  type?: string;
  description?: string;
  providerState?: string;
  request?: {
    body?: unknown;
    headers?: null | string | Record<string, string | string[]>;
    method?: string;
    path?: string;
    query?: null | string | Record<string, string | string[]>;
  };
  response?: {
    body?: unknown;
    headers?: null | string | Record<string, string | string[]>;
    status?: number;
  };
  comments?: {
    references?: {
      AsyncAPI?: { messageId: string; operationId: string };
    };
  };
  contents?: {
    content?: unknown;
    contentType?: string;
    encoded?: string | boolean;
  };
  metadata?: Record<string, string>;
}

const isHttpInteraction = (i: RawInteraction) =>
  i.type === undefined ||
  (typeof i.type === "string" && i.type.toLowerCase() === "synchronous/http");

const isAsyncInteraction = (i: RawInteraction) =>
  typeof i.type === "string" && i.type.toLowerCase() === "asynchronous/messages";

const parseAsPactV4Body = (body: unknown) => {
  if (!body) {
    return undefined;
  }

  const { encoded, content = "" } = body as {
    encoded: string;
    content?: string;
  };

  try {
    if (!encoded) {
      return content;
    }

    if (encoded.toUpperCase() === "JSON") {
      return JSON.parse(content); // throws if fails to parse
    }

    return Buffer.from(content, encoded as BufferEncoding).toString(); // throws if unrecognised encoding
  } catch {
    return content;
  }
};

const cleanString = (s: string) => s.replaceAll(/[\r\n\0]/g, "");

const flattenValues = (
  values?: null | string | Record<string, string | string[]>,
): undefined | string | Record<string, string> => {
  if (!values) return undefined;
  if (typeof values === "string") return values as string;

  return Object.fromEntries(
    Object.entries(values || {}).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map(cleanString).join(",")
        : cleanString(value),
    ]),
  );
};

const interactionV1 = (i: RawInteraction): HttpInteraction => ({
  _kind: "http",
  description: i.description,
  providerState: i.providerState,
  request: {
    ...i.request,
    method: i.request!.method!,
    path: i.request!.path!,
    headers: flattenValues(i.request?.headers) as Record<string, string>,
    query: flattenValues(i.request?.query),
  },
  response: {
    ...i.response,
    status: i.response!.status!,
    headers: flattenValues(i.response?.headers) as Record<string, string>,
  },
});

const interactionV4 = (i: RawInteraction): HttpInteraction => ({
  _kind: "http",
  description: i.description,
  providerState: i.providerState,
  request: {
    ...i.request,
    method: i.request!.method!,
    path: i.request!.path!,
    body: parseAsPactV4Body(i.request?.body),
    headers: flattenValues(i.request?.headers) as Record<string, string>,
    query: flattenValues(i.request?.query),
  },
  response: {
    ...i.response,
    status: i.response!.status!,
    body: parseAsPactV4Body(i.response?.body),
    headers: flattenValues(i.response?.headers) as Record<string, string>,
  },
});

const parseAsyncInteraction = (i: RawInteraction): AsyncInteraction => {
  const asyncapiRef = i.comments?.references?.AsyncAPI;
  return {
    _kind: "async",
    description: i.description,
    providerState: i.providerState,
    asyncapiReferences: asyncapiRef
      ? { messageId: asyncapiRef.messageId, operationId: asyncapiRef.operationId }
      : undefined,
    payload: parseAsPactV4Body(i.contents),
    contentType: i.contents?.contentType,
    metadata: i.metadata,
  };
};

const ajv = new Ajv();
const validateHttpInteractions = ajv.compile(Type.Array(Interaction));
const validateAsyncInteractions = ajv.compile(Type.Array(AsyncMessage));

export const parse = (pact: Pact): ParsedPact => {
  const { metadata, interactions = [] } = pact;
  const rawInteractions = interactions as RawInteraction[];

  const isValid = validateHttpInteractions(rawInteractions.filter(isHttpInteraction));
  if (!isValid) {
    throw new ParserError(validateHttpInteractions.errors!);
  }

  const isAsyncValid = validateAsyncInteractions(rawInteractions.filter(isAsyncInteraction));
  if (!isAsyncValid) {
    throw new ParserError(validateAsyncInteractions.errors!);
  }

  const version = parseInt(
    metadata?.pactSpecification?.version ||
      metadata?.pactSpecificationVersion ||
      metadata?.["pact-specification"]?.version ||
      "0",
  );
  const httpParser =
    version >= 4 ? interactionV4 : interactionV1;

  return {
    metadata,
    interactions: rawInteractions.map((i): ParsedInteraction => {
      if (isHttpInteraction(i)) return httpParser(i);
      if (isAsyncInteraction(i)) return parseAsyncInteraction(i);
      return { _kind: "skip" };
    }),
  };
};

export class ParserError extends Error {
  errors: ErrorObject[];

  constructor(errors: ErrorObject[]) {
    super("Malformed Pact file");
    this.errors = errors;
  }
}
