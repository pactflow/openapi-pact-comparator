export interface Interaction {
  type?: string;
  description?: string;
  providerState?: string;
  request: {
    body?: unknown;
    headers?: Record<string, string>;
    method: string;
    path: string;
    query?: string;
  };
  response: {
    body?: unknown;
    headers?: Record<string, string>;
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

const parseAsPactV4Body = (body: any) => {
  if (!body) {
    return undefined;
  }

  const { encoded, content = "" } = body;

  try {
    if (!encoded) {
      return content;
    }

    if ((encoded as string).toUpperCase() === "JSON") {
      return JSON.parse(content); // throws if fails to parse
    }

    return Buffer.from(content, encoded).toString(); // throws if unrecognised encoding
  } catch {
    return content;
  }
};

const flattenHeaders = (
  headers?: Record<string, string | string[]>,
): Record<string, string> | undefined => {
  if (!headers) return headers;

  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(",") : value,
    ]),
  );
};

const interactionV1 = (i: Interaction): Interaction => ({
  ...i,
  request: {
    ...i.request,
    headers: flattenHeaders(i.request.headers),
  },
  response: {
    ...i.response,
    headers: flattenHeaders(i.response.headers),
  },
});
const interactionV4 = (i: Interaction): Interaction => ({
  ...i,
  request: {
    ...i.request,
    body: parseAsPactV4Body(i.request.body),
    headers: flattenHeaders(i.request.headers),
  },
  response: {
    ...i.response,
    body: parseAsPactV4Body(i.response.body),
    headers: flattenHeaders(i.response.headers),
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
  const interactionParser = version >= 4 ? interactionV4 : interactionV1;

  return {
    metadata,
    interactions: interactions
      .filter(supportedInteractions)
      .map(interactionParser),
  };
};
