import type { ErrorObject } from "ajv";

type InfoCode = "graphql.operation.matched" | "message.matched";

type ErrorCode =
  | "message.graphql.payload.incompatible"
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
  | "request.graphql.argument.missing"
  | "request.graphql.argument.unknown"
  | "request.graphql.document.invalid"
  | "request.graphql.field.unknown"
  | "request.graphql.incompatible"
  | "request.graphql.operation.unknown"
  | "request.graphql.variables.incompatible"
  | "request.header.incompatible"
  | "request.path-or-method.unknown"
  | "request.query.incompatible"
  | "request.spec.missing"
  | "response.body.incompatible"
  | "response.body.unknown"
  | "response.content-type.incompatible"
  | "response.graphql.body.incompatible"
  | "response.header.incompatible"
  | "response.header.unknown"
  | "response.status.unknown";

type WarningCode =
  | "graphql.schema.mismatch"
  | "message.payload.unknown"
  | "message.payload.unvalidatable"
  | "message.response.missing"
  | "pact-broker.no-pacts-found"
  | "request.accept.unknown"
  | "request.body.unknown"
  | "request.body.unvalidatable"
  | "request.content-type.missing"
  | "request.content-type.unknown"
  | "request.graphql.inconsistent"
  | "request.header.unknown"
  | "request.query.unknown"
  | "response.body.unvalidatable"
  | "response.content-type.unknown"
  | "response.graphql.data.null"
  | "response.graphql.errors.unvalidatable"
  | "response.graphql.scalar.unvalidatable"
  | "response.graphql.status.unexpected"
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
