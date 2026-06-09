import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get } from "lodash-es";
import type { OpenAPIV2 } from "openapi-types";

import type { HttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import {
  baseMockDetails,
  formatInstancePath,
  formatMessage,
  formatSchemaPath,
} from "#results/index";
import { minimumSchema, transformReceivedSchema } from "#transform/index";
import type { Config } from "#utils/config";
import { dereferenceOas, splitPath } from "#utils/schema";
import { getValidateFunction } from "#utils/validation";
import { bodyValidationStatus } from "#compare/utils/body";
import { findMatchingType, getByContentType } from "./utils/content";
import { patternedStatus } from "./utils/statusCodes";

const DEFAULT_CONTENT_TYPE = "application/json";

export function* compareResBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: HttpInteraction,
  index: number,
  config: Config,
): Iterable<Result> {
  const { method, oas, operation, path } = route.store;
  const { body, status } = interaction.response;
  const requestHeaders = new Headers(
    interaction.request.headers as Record<string, string>,
  );

  const statusResponse = operation.responses?.[status];
  const patternedResponse = operation.responses?.[patternedStatus(status)];
  const defaultResponse = operation.responses?.["default"];
  const response = statusResponse || patternedResponse || defaultResponse;

  if (!response) {
    yield {
      code: "response.status.unknown",
      message: `Response status code not defined in spec file: ${status}`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].response.status`,
        value: status,
      },
      specDetails: {
        location: `[root].paths.${path}.${method}.responses`,
        pathMethod: method,
        pathName: path,
        value: operation.responses,
      },
      type: "error",
    };
  }

  if (response) {
    const dereferencedResponse = dereferenceOas(response, oas);
    const availableResponseContentTypes =
      operation.produces || Object.keys(dereferencedResponse.content || {});
    const contentType =
      findMatchingType(
        requestHeaders.get("accept") || DEFAULT_CONTENT_TYPE,
        availableResponseContentTypes,
      ) ||
      availableResponseContentTypes[0] ||
      DEFAULT_CONTENT_TYPE;
    const schema: SchemaObject | undefined =
      (dereferencedResponse as OpenAPIV2.ResponseObject)?.schema ||
      getByContentType(dereferencedResponse.content || {}, contentType)?.schema;

    const value = body;

    if (!statusResponse && !patternedResponse) {
      yield {
        code: "response.status.default",
        message: `Response status code matched default response in spec file: ${status}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].response.status`,
          value: status,
        },
        specDetails: {
          location: `[root].paths.${path}.${method}.responses`,
          pathMethod: method,
          pathName: path,
          value: operation.responses,
        },
        type: "warning",
      };
    }

    const bodyStatus = bodyValidationStatus(contentType, value);

    if (bodyStatus === "warn") {
      yield {
        code: "response.body.unvalidatable",
        message: `Body with content type '${contentType}' is not supported by the spec comparator`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].response.body`,
          value,
        },
        specDetails: {
          location: `[root].paths.${path}.${method}.responses.${status}.content`,
          pathMethod: method,
          pathName: path,
          value: response.content,
        },
        type: "warning",
      };
    } else if (bodyStatus === "validate") {
      if (value && !schema) {
        yield {
          code: "response.body.unknown",
          message: "No matching schema found for response body",
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].response.body`,
            value: value,
          },
          specDetails: {
            location: `[root].paths.${path}.${method}.responses.${status}.content`,
            pathMethod: method,
            pathName: path,
            value: response.content,
          },
          type: "error",
        };
      }

      if (value && schema) {
        const schemaId = `[root].paths.${path}.${method}.responses.${status}.content.${contentType}`;
        const validate = getValidateFunction(ajv, schemaId, () =>
          transformReceivedSchema(
            minimumSchema(schema, oas),
            config.get("no-transform-non-nullable-response-schema")!,
          ),
        );
        if (!validate(value)) {
          for (const error of validate.errors!) {
            yield {
              code: "response.body.incompatible",
              message: `Response body is incompatible with the response body schema in the spec file: ${formatMessage(error)}`,
              mockDetails: {
                ...baseMockDetails(interaction),
                location: `[root].interactions[${index}].response.body${formatInstancePath(error)}`,
                value: error.instancePath
                  ? get(value, splitPath(error.instancePath))
                  : value,
              },
              specDetails: {
                location: `${schemaId}.schema.${formatSchemaPath(error)}`,
                pathMethod: method,
                pathName: path,
                value: get(validate!.schema, splitPath(error.schemaPath)),
              },
              type: "error",
            };
          }
        }
      }
    }
  }
}
