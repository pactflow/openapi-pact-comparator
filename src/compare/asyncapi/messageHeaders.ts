import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import { get } from "lodash-es";
import type { Message } from "#documents/asyncapi";
import type { AsyncInteraction } from "#documents/pact";
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
  interaction: AsyncInteraction,
  index: number,
  messagePath: string,
): Iterable<Result> {
  if (!message.headers) return;

  const { metadata } = interaction;
  if (metadata === undefined) return;

  const schemaId = `${messagePath}.headers`;
  const validate = getValidateFunction(ajv, schemaId, () =>
    transformReceivedSchema(structuredClone(message.headers) as SchemaObject),
  );

  if (!validate(metadata)) {
    for (const error of validate.errors!) {
      yield {
        code: "message.headers.incompatible",
        message: `Message headers are incompatible with the schema in the spec file: ${formatMessage(error)}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].metadata${formatInstancePath(error)}`,
          value: error.instancePath
            ? get(metadata, splitPath(error.instancePath))
            : metadata,
        },
        specDetails: {
          location: `${schemaId}.${formatSchemaPath(error)}`,
          value: get(validate.schema, splitPath(error.schemaPath)),
        },
        type: "error",
      };
    }
  }
}
