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
  interaction: AsyncInteraction,
  index: number,
  operationId: string,
  messageId: string,
): Iterable<Result> {
  const { payload, contentType } = interaction;

  if (!canValidate(contentType)) return;

  if (!message.payload) {
    if (payload !== undefined) {
      yield {
        code: "message.payload.unknown",
        message: "No schema found for message payload",
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].contents`,
          value: payload,
        },
        specDetails: {
          location: `[root].operations.${operationId}.messages`,
          value: undefined,
        },
        type: "warning",
      };
    }
    return;
  }

  const schemaId = `[root].operations.${operationId}.messages.${messageId}.payload`;
  const validate = getValidateFunction(
    ajv,
    schemaId,
    () => message.payload as object,
  );
  if (!validate(payload)) {
    for (const error of validate.errors!) {
      yield {
        code: "message.payload.incompatible",
        message: `Message payload is incompatible with the schema in the spec file: ${formatMessage(error)}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].contents${formatInstancePath(error)}`,
          value: error.instancePath
            ? get(payload, splitPath(error.instancePath))
            : payload,
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
