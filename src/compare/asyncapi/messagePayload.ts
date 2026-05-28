import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import { get } from "lodash-es";
import type { Message } from "#documents/asyncapi";
import type { Result } from "#results/index";
import {
  baseMockDetails,
  formatInstancePath,
  formatMessage,
  formatSchemaPath,
} from "#results/index";
import { transformReceivedSchema } from "#transform/index";
import { splitPath } from "#utils/schema";
import { getValidateFunction } from "#utils/validation";

const canValidate = (contentType: string | undefined): boolean => {
  if (typeof contentType !== "string") return false;
  const normalized = contentType.split(";", 1)[0].trim().toLowerCase();
  return normalized === "application/json" || normalized.endsWith("+json");
};

export function* compareMessagePayload(
  ajv: Ajv,
  message: Message,
  content: { payload: unknown; contentType?: string },
  interactionContext: { description?: string; providerState?: string },
  contentLocation: string,
  messagePath: string,
  direction: "request" | "response",
): Iterable<Result> {
  if (!canValidate(content.contentType)) return;

  if (!message.payload) {
    if (content.payload !== undefined) {
      yield {
        code: "message.payload.unknown",
        message: "No schema found for message payload",
        mockDetails: {
          ...baseMockDetails(interactionContext),
          location: contentLocation,
          value: content.payload,
        },
        specDetails: {
          location: messagePath,
          value: undefined,
        },
        type: "warning",
      };
    }
    return;
  }

  const schemaPath = `${messagePath}.payload`;
  const schemaId = `${schemaPath}#${direction}`;
  const validate = getValidateFunction(ajv, schemaId, () => {
    const rawSchema = structuredClone(message.payload) as SchemaObject;
    return direction === "response"
      ? transformReceivedSchema(rawSchema)
      : rawSchema;
  });
  if (!validate(content.payload)) {
    for (const error of validate.errors ?? []) {
      yield {
        code: "message.payload.incompatible",
        message: `Message payload is incompatible with the schema in the spec file: ${formatMessage(error)}`,
        mockDetails: {
          ...baseMockDetails(interactionContext),
          location: `${contentLocation}${formatInstancePath(error)}`,
          value: error.instancePath
            ? get(content.payload, splitPath(error.instancePath))
            : content.payload,
        },
        specDetails: {
          location: `${schemaPath}.${formatSchemaPath(error)}`,
          value: get(validate.schema, splitPath(error.schemaPath)),
        },
        type: "error",
      };
    }
  }
}
