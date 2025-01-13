import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { get } from "lodash-es";
import {
  baseMockDetails,
  formatErrorMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results";
import { transformResponseSchema, optimiseSchema } from "../transform";
import { findMatchingType } from "./utils/content";

const DEFAULT_CONTENT_TYPE = "application/json";

export function* compareResBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { components, definitions, method, operation, path } = route.store;
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

    if ((response as OpenAPIV2.ResponseObject).schema || response.content) {
      const availableResponseContentTypes =
        operation.produces || Object.keys(response.content || {});
      const contentType = findMatchingType(
        requestHeaders.get("accept") || DEFAULT_CONTENT_TYPE,
        availableResponseContentTypes,
      );
      const schema: SchemaObject =
        (response as OpenAPIV2.ResponseObject).schema ||
        response.content[contentType]?.schema;
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
              transformResponseSchema(
                optimiseSchema(schema, components, definitions),
              ),
              schemaId,
            );
            validate = ajv.getSchema(schemaId);
          }
          if (!validate(value)) {
            for (const error of validate.errors) {
              const message = formatErrorMessage(error);
              const instancePath = formatInstancePath(error.instancePath);
              const schemaPath = formatSchemaPath(error.schemaPath);

              yield {
                code: "response.body.incompatible",
                message: `Response body is incompatible with the response body schema in the spec file: ${message}`,
                mockDetails: {
                  ...baseMockDetails(interaction),
                  location: `[root].interactions[${index}].response.body.${instancePath}`,
                  value: instancePath ? get(value, instancePath) : value,
                },
                specDetails: {
                  location: `${schemaId}.schema.${schemaPath}`,
                  pathMethod: method,
                  pathName: path,
                  value: get(validate.schema, schemaPath),
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
