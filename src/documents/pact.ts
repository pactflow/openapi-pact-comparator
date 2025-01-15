export interface Interaction {
  type?: string;
  description?: string;
  providerState?: string;
  request: {
    body?: unknown;
    headers?: Record<string, string | string[]>;
    method: string;
    path: string;
    query?: string | Record<string, string | string[]>;
  };
  response: {
    body?: unknown;
    headers?: Record<string, string | string[]>;
    status: number;
  };
}

export interface Pact {
  metadata?: {
    pactSpecification?: {
      version: string;
    };
    pactSpecificationVersion?: string;
    "pact-specification"?: {
      version: string;
    };
  };
  interactions: Interaction[];
}

const supportedInteractions = (i: Interaction) =>
  !i.type || i.type === "Synchronous/HTTP";

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

const flattenValues = (
  values?: string | Record<string, string | string[]>,
): Record<string, string> | string | undefined => {
  if (!values || typeof values === "string") return values;

  return Object.fromEntries(
    Object.entries(values || {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(",") : value,
    ]),
  );
};

const interactionV1 = (i: Interaction): Interaction => ({
  ...i,
  request: {
    ...i.request,
    headers: flattenValues(i.request.headers) as Record<string, string>,
  },
  response: {
    ...i.response,
    headers: flattenValues(i.response.headers) as Record<string, string>,
  },
});

const interactionV3 = (i: Interaction): Interaction => ({
  ...i,
  request: {
    ...i.request,
    headers: flattenValues(i.request.headers) as Record<string, string>,
    query: flattenValues(i.request.query),
  },
  response: {
    ...i.response,
    headers: flattenValues(i.response.headers) as Record<string, string>,
  },
});

const interactionV4 = (i: Interaction): Interaction => ({
  ...i,
  request: {
    ...i.request,
    body: parseAsPactV4Body(i.request.body),
    headers: flattenValues(i.request.headers) as Record<string, string>,
    query: flattenValues(i.request.query),
  },
  response: {
    ...i.response,
    body: parseAsPactV4Body(i.response.body),
    headers: flattenValues(i.response.headers) as Record<string, string>,
  },
});

export const parse = (pact: Pact): Pact => {
  const { metadata, interactions } = pact;
  const version = parseInt(
    metadata?.pactSpecification?.version ||
      metadata?.pactSpecificationVersion ||
      metadata?.["pact-specification"]?.version ||
      "0",
  );
  const interactionParser =
    version >= 4 ? interactionV4 : version >= 3 ? interactionV3 : interactionV1;

  return {
    metadata,
    interactions: interactions
      .filter(supportedInteractions)
      .map(interactionParser),
  };
};
