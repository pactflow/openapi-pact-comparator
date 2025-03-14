import { Static, Type } from "@sinclair/typebox";
import Ajv, { ErrorObject } from "ajv";

// a full schema can be found at https://github.com/pactflow/pact-schemas
// but we don't use that here, because we try to be permissive with input
export const Interaction = Type.Object({
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
  interactions: Type.Array(Interaction),
});

export type Pact = Static<typeof Pact>;

const supportedInteractions = (i: Interaction) =>
  !i.type || i.type.toLowerCase() === "synchronous/http";

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

const ajv = new Ajv();
const validate = ajv.compile(Pact);

export const parse = (pact: Pact): Pact => {
  const { metadata, interactions } = pact;

  const isValid = validate({
    metadata,
    interactions: interactions.filter(supportedInteractions),
  });
  if (!isValid) {
    throw new ParserError(validate.errors!);
  }

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

export class ParserError extends Error {
  errors: ErrorObject[];

  constructor(errors: ErrorObject[]) {
    super("Malformed Pact file");
    this.errors = errors;
  }
}
