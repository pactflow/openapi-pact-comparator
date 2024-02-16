import type { ErrorObject } from "ajv";
import type { Interaction } from "../documents/pact";

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
