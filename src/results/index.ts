import type { ErrorObject } from "ajv";
import type { Interaction } from "../documents/pact";

type ErrorCode =
  | "request.accept.incompatible"
  | "request.authorization.missing" // TODO
  | "request.body.incompatible"
  | "request.content-type.incompatible"
  | "request.header.incompatible" // TODO
  | "request.path-or-method.unknown" // TODO: needs test
  | "request.query.incompatible"
  | "response.body.incompatible"
  | "response.body.unknown" // TODO
  | "response.content-type.incompatible"
  | "response.header.incompatible" // TODO
  | "response.header.unknown" // TODO
  | "response.status.unknown";

type WarningCode =
  | "pact-broker.no-pacts-found" // TODO
  | "request.accept.unknown"
  | "request.body.unknown" // TODO
  | "request.content-type.missing"
  | "request.content-type.unknown"
  | "request.header.unknown"
  | "request.query.unknown" // needs test
  | "response.content-type.unknown"
  | "response.header.undefined" // TODO
  | "response.status.default"; // TODO

export interface Result {
  code: ErrorCode | WarningCode;
  message: string;
  mockDetails?: {
    interactionDescription: string | null;
    interactionState: string | null;
    location: string;
    mockFile?: string;
    value: any;
  };
  source: "spec-mock-validation";
  specDetails?: {
    location: string;
    pathMethod: string | null;
    pathName: string | null;
    specFile?: string;
    value: any;
  };
  type: "error" | "warning";
}

export const formatInstancePath = (path: string) =>
  path.replace(/\//g, ".").substring(1);

export const formatErrorMessage = (error: ErrorObject) =>
  error.keyword === "additionalProperties"
    ? `${error.message} - ${error.params.additionalProperty}`
    : error.message;

export const formatSchemaPath = (path: string) =>
  path.replace(/\//g, ".").substring(2);

export const baseMockDetails = (interaction: Interaction) => ({
  interactionDescription: interaction.description,
  interactionState: interaction.providerState || "[none]",
});
