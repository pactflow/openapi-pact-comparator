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

export function* compareMessageHeaders(
  ajv: Ajv,
  message: Message,
  content: { metadata?: Record<string, string> },
  interactionContext: { description?: string; providerState?: string },
  metadataLocation: string,
  messagePath: string,
  direction: "request" | "response",
): Iterable<Result> {
  if (!message.headers) return;
  if (content.metadata === undefined) return;

  const schemaPath = `${messagePath}.headers`;
  const schemaId = `${schemaPath}#${direction}`;
  const validate = getValidateFunction(ajv, schemaId, () => {
    const rawSchema = structuredClone(message.headers) as SchemaObject;
    return direction === "response"
      ? transformReceivedSchema(rawSchema)
      : rawSchema;
  });
  if (!validate(content.metadata)) {
    for (const error of validate.errors!) {
      yield {
        code: "message.headers.incompatible",
        message: `Message headers are incompatible with the schema in the spec file: ${formatMessage(error)}`,
        mockDetails: {
          ...baseMockDetails(interactionContext),
          location: `${metadataLocation}${formatInstancePath(error)}`,
          value: error.instancePath
            ? get(content.metadata, splitPath(error.instancePath))
            : content.metadata,
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
