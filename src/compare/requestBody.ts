import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type { OpenAPIV2 } from "openapi-types";
import type Router from "find-my-way";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { get } from "lodash-es";
import qs from "qs";
import {
  baseMockDetails,
  formatErrorMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results";
import { minimumSchema, transformRequestSchema } from "../transform";
import { findMatchingType } from "./utils/content";
import { dereferenceOas } from "./utils/schema";

const parseBody = (body: unknown, contentType: string) => {
  if (
    contentType.includes("application/x-www-form-urlencoded") &&
    typeof body === "string"
  ) {
    return qs.parse(body as string, { allowDots: true, comma: true });
  }

  return body;
};

const canValidate = (contentType: string): boolean => {
  return !!findMatchingType(contentType, [
    "application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ]);
};

const DEFAULT_CONTENT_TYPE = "application/json";

export function* compareReqBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { method, oas, operation, path } = route.store;
  const { body } = interaction.request;
  const requestHeaders = new Headers(
    interaction.request.headers as Record<string, string>,
  );

  const availableRequestContentTypes =
    operation.consumes ||
    Object.keys(
      dereferenceOas(operation.requestBody || {}, oas)?.content || {},
    );
  const contentType =
    findMatchingType(
      requestHeaders.get("content-type") || DEFAULT_CONTENT_TYPE,
      availableRequestContentTypes,
    ) || DEFAULT_CONTENT_TYPE;

  const schema: SchemaObject | undefined =
    dereferenceOas(operation.requestBody || {}, oas)?.content?.[contentType]
      ?.schema ||
    dereferenceOas(
      (operation.parameters || []).find(
        (p: OpenAPIV2.ParameterObject) => p.in === "body",
      ) || {},
      oas,
    )?.schema;

  if (body || body === "") {
    if (!schema) {
      yield {
        code: "request.body.unknown",
        message: "No matching schema found for request body",
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].response.body`,
          value: body,
        },
        specDetails: {
          location: `[root].paths.${path}.${method}.requestBody.content`,
          pathMethod: method,
          pathName: path,
          value: operation.requestBody?.content,
        },
        type: "error",
      };
    } else if (interaction.response.status < 400) {
      const value = parseBody(body, contentType);

      if (schema && canValidate(contentType)) {
        const schemaId = `[root].paths.${path}.${method}.requestBody.content.${contentType}`;
        let validate = ajv.getSchema(schemaId);
        if (!validate) {
          ajv.addSchema(
            transformRequestSchema(minimumSchema(schema, oas)),
            schemaId,
          );
          validate = ajv.getSchema(schemaId);
        }
        if (!validate!(value)) {
          for (const error of validate!.errors!) {
            const message = formatErrorMessage(error);
            const instancePath = formatInstancePath(error.instancePath);
            const schemaPath = formatSchemaPath(error.schemaPath);

            yield {
              code: "request.body.incompatible",
              message: `Request body is incompatible with the request body schema in the spec file: ${message}`,
              mockDetails: {
                ...baseMockDetails(interaction),
                location: `[root].interactions[${index}].request.body.${instancePath}`,
                value: instancePath ? get(value, instancePath) : value,
              },
              specDetails: {
                location: `${schemaId}.schema.${schemaPath}`,
                pathMethod: method,
                pathName: path,
                value: get(validate!.schema, schemaPath),
              },
              type: "error",
            };
          }
        }
      }
    }
  }
}
