import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import { get } from "lodash-es";

import type { Interaction } from "../documents/pact";
import type { Result } from "../results/index";
import {
  baseMockDetails,
  formatMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results/index";
import { minimumSchema, transformResponseSchema } from "../transform/index";
import { findMatchingType } from "./utils/content";
import { dereferenceOas, splitPath } from "../utils/schema";

const DEFAULT_CONTENT_TYPE = "application/json";

export function* compareResBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Result> {
  const { method, oas, operation, path } = route.store;
  const { body, status } = interaction.response;
  const requestHeaders = new Headers(
    interaction.request.headers as Record<string, string>,
  );

  const statusResponse = operation.responses?.[
    status
  ] as OpenAPIV3.ResponseObject;
  const defaultResponse = operation.responses
    ?.default as OpenAPIV3.ResponseObject;
  const response = statusResponse || defaultResponse;

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
  } else {
    if (!statusResponse) {
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

    if (response) {
      const availableResponseContentTypes =
        operation.produces || Object.keys(response.content || {});
      const contentType =
        findMatchingType(
          requestHeaders.get("accept") || DEFAULT_CONTENT_TYPE,
          availableResponseContentTypes,
        ) || DEFAULT_CONTENT_TYPE;
      const dereferencedResponse = dereferenceOas(response, oas);
      const schema: SchemaObject | undefined =
        (dereferencedResponse as OpenAPIV2.ResponseObject).schema ||
        dereferencedResponse.content?.[contentType]?.schema;
      const value = body;

      if (body) {
        if (!schema) {
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
        } else if (value) {
          const schemaId = `[root].paths.${path}.${method}.responses.${status}.content.${contentType}`;
          let validate = ajv.getSchema(schemaId);
          if (!validate) {
            ajv.addSchema(
              transformResponseSchema(minimumSchema(schema, oas)),
              schemaId,
            );
            validate = ajv.getSchema(schemaId);
          }
          if (!validate!(value)) {
            for (const error of validate!.errors!) {
              yield {
                code: "response.body.incompatible",
                message: `Response body is incompatible with the response body schema in the spec file: ${formatMessage(error)}`,
                mockDetails: {
                  ...baseMockDetails(interaction),
                  location: `[root].interactions[${index}].response.body.${formatInstancePath(error)}`,
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
}
