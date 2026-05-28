import type { ErrorObject } from "ajv";

type InfoCode = "message.matched";

type ErrorCode =
  | "message.headers.incompatible"
  | "message.no.match"
  | "message.operation.unknown"
  | "message.payload.incompatible"
  | "message.references.missing"
  | "message.reply.missing"
  | "message.spec.missing"
  | "request.accept.incompatible"
  | "request.authorization.missing"
  | "request.body.incompatible"
  | "request.content-type.incompatible"
  | "request.header.incompatible"
  | "request.path-or-method.unknown"
  | "request.query.incompatible"
  | "request.spec.missing"
  | "response.body.incompatible"
  | "response.body.unknown"
  | "response.content-type.incompatible"
  | "response.header.incompatible"
  | "response.header.unknown"
  | "response.status.unknown";

type WarningCode =
  | "message.payload.unknown"
  | "message.response.missing"
  | "pact-broker.no-pacts-found"
  | "request.accept.unknown"
  | "request.body.unknown"
  | "request.content-type.missing"
  | "request.content-type.unknown"
  | "request.header.unknown"
  | "request.query.unknown"
  | "response.content-type.unknown"
  | "response.header.undefined"
  | "response.status.default";

export interface Result {
  code: ErrorCode | WarningCode | InfoCode;
  message: string;
  mockDetails?: {
    interactionDescription?: string | null;
    interactionState?: string | null;
    location: string;
    value: unknown;
  };
  specDetails?: {
    location: string;
    pathMethod?: string | null;
    pathName?: string | null;
    value: unknown;
  };
  type: "error" | "warning" | "info";
  causes?: Result[];
}

export const formatMessage = (error: ErrorObject) =>
  error.keyword === "additionalProperties"
    ? `${error.message} - ${error.params.additionalProperty}`
    : error.message;

export const formatInstancePath = (error: ErrorObject) =>
  error.instancePath.replace(/\//g, ".");

export const formatSchemaPath = (error: ErrorObject) =>
  error.schemaPath.replace(/\//g, ".").substring(2);

export const baseMockDetails = (interaction: {
  description?: string;
  providerState?: string;
}) => ({
  interactionDescription: interaction.description,
  interactionState: interaction.providerState || "[none]",
});
