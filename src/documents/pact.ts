import { type Static, Type } from "@sinclair/typebox";
import Ajv, { type ErrorObject } from "ajv";
import { looksLikeGraphqlDocument } from "#documents/graphql";

// a full schema can be found at https://github.com/pactflow/pact-schemas
// but we don't use that here, because we try to be permissive with input

// HTTP-only schema used for AJV validation of synchronous interactions
const HttpMessage = Type.Object({
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

// Async interaction schema used for AJV validation of "Asynchronous/Messages" interactions
const AsyncMessage = Type.Object({
  type: Type.String(),
  description: Type.Optional(Type.String()),
  providerState: Type.Optional(Type.String()),
  contents: Type.Optional(
    Type.Object({
      content: Type.Optional(Type.Unknown()),
      contentType: Type.Optional(Type.String()),
      encoded: Type.Optional(Type.Union([Type.String(), Type.Literal(false)])),
    }),
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
  comments: Type.Optional(
    Type.Object({
      references: Type.Optional(
        Type.Object({
          AsyncAPI: Type.Optional(Type.Unknown()),
        }),
      ),
    }),
  ),
});

const SyncMessageSide = Type.Object({
  contents: Type.Optional(
    Type.Object({
      content: Type.Optional(Type.Unknown()),
      contentType: Type.Optional(Type.String()),
      encoded: Type.Optional(Type.Union([Type.String(), Type.Literal(false)])),
    }),
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
});

const SyncMessage = Type.Object({
  type: Type.String(),
  description: Type.Optional(Type.String()),
  providerState: Type.Optional(Type.String()),
  request: SyncMessageSide,
  response: Type.Array(SyncMessageSide),
  comments: Type.Optional(
    Type.Object({
      references: Type.Optional(
        Type.Object({
          AsyncAPI: Type.Optional(Type.Unknown()),
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

export interface GraphqlOperation {
  /** Which part of the pact the operation was read from. */
  source: "plugin" | "body";
  document: string;
  operationName?: string;
  variables: Record<string, unknown>;
  /** Plugin configuration and request body disagree (requirements 4.1). */
  inconsistent: boolean;
}

export interface GraphqlPluginConfig {
  inlineSchemaSdl?: string;
  schemaHash?: string;
}

export interface GraphqlHttpInteraction {
  _kind: "graphql-http";
  description?: string;
  providerState?: string;
  operation: GraphqlOperation;
  request: HttpInteraction["request"];
  response: HttpInteraction["response"];
  plugin?: GraphqlPluginConfig;
}

export interface AsyncInteraction {
  _kind: "async";
  description?: string;
  providerState?: string;
  asyncapiReferences?: { operationId?: string };
  payload: unknown;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface SyncInteraction {
  _kind: "sync";
  description?: string;
  providerState?: string;
  asyncapiReferences?: { operationId?: string };
  request: {
    payload: unknown;
    contentType?: string;
    metadata?: Record<string, string>;
  };
  responses: Array<{
    payload: unknown;
    contentType?: string;
    metadata?: Record<string, string>;
  }>;
}

export interface SkippedInteraction {
  _kind: "skip";
}

export interface GraphqlMessageInteraction {
  _kind: "graphql-message";
  description?: string;
  providerState?: string;
  operation: GraphqlOperation;
  /** Normalised to a GraphQL response envelope: `{ data: … }`. */
  payload: unknown;
  plugin?: GraphqlPluginConfig;
}

export type Interaction =
  | HttpInteraction
  | GraphqlHttpInteraction
  | GraphqlMessageInteraction
  | AsyncInteraction
  | SyncInteraction
  | SkippedInteraction;

export interface ParsedPact {
  metadata?: Pact["metadata"];
  interactions: Interaction[];
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
      AsyncAPI?: { operationId?: string };
    };
  };
  contents?: {
    content?: unknown;
    contentType?: string;
    encoded?: string | boolean;
  };
  metadata?: Record<string, string>;
  pluginConfiguration?: {
    graphql?: {
      query_document?: string;
      operation_name?: string;
      variables_json?: string;
      inline_schema?: { base64_sdl?: string };
      schema_ref?: { hash?: string };
    };
  };
}

interface RawSyncInteraction {
  type: string;
  description?: string;
  providerState?: string;
  request: {
    contents?: {
      content?: unknown;
      contentType?: string;
      encoded?: string | boolean;
    };
    metadata?: Record<string, string>;
  };
  response: Array<{
    contents?: {
      content?: unknown;
      contentType?: string;
      encoded?: string | boolean;
    };
    metadata?: Record<string, string>;
  }>;
  comments?: {
    references?: {
      AsyncAPI?: { operationId?: string };
    };
  };
}

const isHttpInteraction = (i: RawInteraction) =>
  i.type === undefined ||
  (typeof i.type === "string" && i.type.toLowerCase() === "synchronous/http");

const isAsyncInteraction = (i: RawInteraction) =>
  typeof i.type === "string" &&
  i.type.toLowerCase() === "asynchronous/messages";

const isSyncInteraction = (
  i: RawInteraction,
): i is RawInteraction & RawSyncInteraction =>
  typeof i.type === "string" && i.type.toLowerCase() === "synchronous/messages";

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

const asAsyncapiReferences = (
  asyncapiRef: unknown,
): { operationId?: string } | undefined => {
  if (!asyncapiRef) return undefined;
  if (typeof asyncapiRef !== "object") return {};
  return { ...asyncapiRef };
};

const parseAsyncInteraction = (i: RawInteraction): AsyncInteraction => {
  const asyncapiRef = asAsyncapiReferences(i.comments?.references?.AsyncAPI);
  return {
    _kind: "async",
    description: i.description,
    providerState: i.providerState,
    asyncapiReferences: asyncapiRef,
    payload: parseAsPactV4Body(i.contents),
    contentType: i.contents?.contentType,
    metadata: i.metadata,
  };
};

const parseSyncInteraction = (
  i: RawInteraction & RawSyncInteraction,
): SyncInteraction => {
  const asyncapiRef = asAsyncapiReferences(i.comments?.references?.AsyncAPI);
  return {
    _kind: "sync",
    description: i.description,
    providerState: i.providerState,
    asyncapiReferences: asyncapiRef,
    request: {
      payload: parseAsPactV4Body(i.request.contents),
      contentType: i.request.contents?.contentType,
      metadata: i.request.metadata,
    },
    responses: i.response.map((r) => ({
      payload: parseAsPactV4Body(r.contents),
      contentType: r.contents?.contentType,
      metadata: r.metadata,
    })),
  };
};

const GRAPHQL_BODY_KEYS = new Set([
  "query",
  "variables",
  "operationName",
  "extensions",
]);

interface GraphqlEnvelope {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

/** The request body read as a GraphQL over HTTP envelope, if it is one. */
const asGraphqlEnvelope = (body: unknown): GraphqlEnvelope | undefined => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return undefined;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((k) => !GRAPHQL_BODY_KEYS.has(k)))
    return undefined;
  if (typeof record.query !== "string") return undefined;
  return {
    query: record.query,
    variables: (record.variables as Record<string, unknown>) ?? undefined,
    operationName:
      typeof record.operationName === "string"
        ? record.operationName
        : undefined,
  };
};

const parseJsonObject = (value?: string): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const decodeBase64 = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return undefined;
  }
};

/**
 * Requirements section 4: an interaction is GraphQL when it carries plugin
 * configuration, declares an `application/graphql` content type, or is a POST
 * whose body is a GraphQL envelope containing a parseable operation.
 */
const asGraphqlHttpInteraction = (
  parsed: HttpInteraction,
  raw: RawInteraction,
): GraphqlHttpInteraction | undefined => {
  const pluginConfig = raw.pluginConfiguration?.graphql;
  const envelope = asGraphqlEnvelope(parsed.request.body);

  const contentType =
    parsed.request.headers?.["content-type"] ??
    parsed.request.headers?.["Content-Type"] ??
    (raw.request?.body as { contentType?: string } | undefined)?.contentType;

  const declaredGraphql =
    typeof contentType === "string" &&
    contentType.toLowerCase().startsWith("application/graphql");

  const heuristicGraphql =
    parsed.request.method.toUpperCase() === "POST" &&
    envelope !== undefined &&
    looksLikeGraphqlDocument(envelope.query);

  if (!pluginConfig && !declaredGraphql && !heuristicGraphql) return undefined;

  const pluginDocument = pluginConfig?.query_document;
  const pluginVariables = parseJsonObject(pluginConfig?.variables_json);

  const document = pluginDocument ?? envelope?.query;
  if (!document) return undefined;

  const source: "plugin" | "body" = pluginDocument ? "plugin" : "body";
  const variables = pluginDocument
    ? pluginVariables
    : (envelope?.variables ?? {});
  const operationName = pluginDocument
    ? pluginConfig?.operation_name
    : envelope?.operationName;

  const inconsistent = Boolean(
    pluginDocument &&
    envelope &&
    (envelope.query !== pluginDocument ||
      JSON.stringify(envelope.variables ?? {}) !==
        JSON.stringify(pluginVariables)),
  );

  const inlineSchemaSdl = decodeBase64(pluginConfig?.inline_schema?.base64_sdl);
  const schemaHash = pluginConfig?.schema_ref?.hash;

  return {
    _kind: "graphql-http",
    description: parsed.description,
    providerState: parsed.providerState,
    operation: { source, document, operationName, variables, inconsistent },
    request: parsed.request,
    response: parsed.response,
    plugin:
      inlineSchemaSdl || schemaHash
        ? { inlineSchemaSdl, schemaHash }
        : undefined,
  };
};

const asGraphqlMessageInteraction = (
  i: RawInteraction,
): GraphqlMessageInteraction | undefined => {
  const pluginConfig = i.pluginConfiguration?.graphql;
  const document = pluginConfig?.query_document;
  // There is no non-plugin convention for GraphQL subscription messages, so
  // no heuristic applies here (requirements section 4).
  if (!document) return undefined;

  const contents = parseAsPactV4Body(i.contents) as
    | {
        subscription?: string;
        variables?: Record<string, unknown>;
        data?: unknown;
      }
    | undefined;

  const inlineSchemaSdl = decodeBase64(pluginConfig?.inline_schema?.base64_sdl);
  const schemaHash = pluginConfig?.schema_ref?.hash;

  return {
    _kind: "graphql-message",
    description: i.description,
    providerState: i.providerState,
    operation: {
      source: "plugin",
      document,
      operationName: pluginConfig?.operation_name ?? contents?.subscription,
      variables: parseJsonObject(pluginConfig?.variables_json),
      inconsistent: false,
    },
    payload: contents ? { data: contents.data } : undefined,
    plugin:
      inlineSchemaSdl || schemaHash
        ? { inlineSchemaSdl, schemaHash }
        : undefined,
  };
};

const ajv = new Ajv();
const validateHttpInteractions = ajv.compile(Type.Array(HttpMessage));
const validateAsyncInteractions = ajv.compile(Type.Array(AsyncMessage));
const validateSyncInteractions = ajv.compile(Type.Array(SyncMessage));

export const parse = (pact: Pact): ParsedPact => {
  const { metadata, interactions = [] } = pact;
  const rawInteractions = (interactions as unknown[]).filter(
    (i): i is RawInteraction => typeof i === "object" && i !== null,
  );

  const isValid = validateHttpInteractions(
    rawInteractions.filter(isHttpInteraction),
  );
  if (!isValid) {
    throw new ParserError(validateHttpInteractions.errors!);
  }

  const isAsyncValid = validateAsyncInteractions(
    rawInteractions.filter(isAsyncInteraction),
  );
  if (!isAsyncValid) {
    throw new ParserError(validateAsyncInteractions.errors!);
  }

  const isSyncValid = validateSyncInteractions(
    rawInteractions.filter(isSyncInteraction),
  );
  if (!isSyncValid) {
    throw new ParserError(validateSyncInteractions.errors!);
  }

  const version = parseInt(
    metadata?.pactSpecification?.version ||
      metadata?.pactSpecificationVersion ||
      metadata?.["pact-specification"]?.version ||
      "0",
  );
  const httpParser = version >= 4 ? interactionV4 : interactionV1;

  return {
    metadata,
    interactions: rawInteractions.map((i): Interaction => {
      if (isHttpInteraction(i)) {
        const parsed = httpParser(i);
        return asGraphqlHttpInteraction(parsed, i) ?? parsed;
      }
      if (isAsyncInteraction(i)) {
        return asGraphqlMessageInteraction(i) ?? parseAsyncInteraction(i);
      }
      if (isSyncInteraction(i)) return parseSyncInteraction(i);
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
