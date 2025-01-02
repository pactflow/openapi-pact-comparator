import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { get } from "lodash-es";
import {
  baseMockDetails,
  formatErrorMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results";
import { transformResponseSchema } from "../transform";

const DEFAULT_CONTENT_TYPE = "application/json";

export function* compareResBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { components, method, operation, path } = route.store;

  const { body, status } = interaction.response;
  const headers = new Headers(interaction.request.headers);
  let contentType: string = headers.get("accept")?.split(";")[0];

  const response = operation.responses?.[status] as OpenAPIV3.ResponseObject;
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

  if (response && response.content) {
    contentType ||= DEFAULT_CONTENT_TYPE;
    const schema: SchemaObject = response.content[contentType]?.schema;
    if (schema && body) {
      schema.components = components;
      const schemaId = `response-${method}-${path}-${status}-${contentType}`;
      let validate = ajv.getSchema(schemaId);
      if (!validate) {
        ajv.addSchema(transformResponseSchema(schema), schemaId);
        validate = ajv.getSchema(schemaId);
      }
      if (!validate(body)) {
        for (const error of validate.errors) {
          const message = formatErrorMessage(error);
          const instancePath = formatInstancePath(error.instancePath);
          const schemaPath = formatSchemaPath(error.schemaPath);

          yield {
            code: "response.body.incompatible",
            message: `Response body is incompatible with the response body schema in the spec file: ${message}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: [
                `[root].interactions[${index}].response.body`,
                instancePath,
              ]
                .filter(Boolean)
                .join("."),
              value: instancePath ? get(body, instancePath) : body,
            },
            specDetails: {
              location: `[root].paths.${path}.${method}.responses.${status}.content.${contentType}.schema.${schemaPath}`,
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
