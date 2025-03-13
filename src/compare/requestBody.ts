import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type { OpenAPIV2 } from "openapi-types";
import type Router from "find-my-way";
import { get } from "lodash-es";
import qs from "qs";
import querystring from "node:querystring";
import multipart from "parse-multipart-data";

import type { Interaction } from "../documents/pact";
import type { Result } from "../results/index";
import {
  baseMockDetails,
  formatMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results/index";
import { minimumSchema, transformRequestSchema } from "../transform/index";
import type { Config } from "../utils/config";
import { isValidRequest } from "../utils/interaction";
import { dereferenceOas, splitPath } from "../utils/schema";
import { getValidateFunction } from "../utils/validation";
import { findMatchingType, getByContentType } from "./utils/content";

const parseBody = (
  body: unknown,
  contentType: string,
  legacyParser: boolean,
) => {
  if (
    contentType.includes("application/x-www-form-urlencoded") &&
    typeof body === "string"
  ) {
    return legacyParser
      ? querystring.parse(body as string)
      : qs.parse(body as string, {
          allowDots: true,
          comma: true,
        });
  }

  if (contentType.includes("multipart/form-data") && typeof body === "string") {
    const match = contentType.match(/boundary=(.*)/);
    const boundary = match?.[1];

    if (boundary) {
      const parts = multipart.parse(Buffer.from(body), boundary) as {
        name: string;
        data: Buffer;
      }[];
      return parts.reduce(
        (acc, part) => {
          acc[part.name] = part.data.toString();
          return acc;
        },
        {} as Record<string, string>,
      );
    }
  }

  return body;
};

const canValidate = (
  contentType: string,
  disableMultipartFormdata: boolean,
): boolean => {
  return !!findMatchingType(
    contentType,
    [
      "application/json",
      "application/x-www-form-urlencoded",
      disableMultipartFormdata ? "" : "multipart/form-data",
    ].filter(Boolean),
  );
};

const DEFAULT_CONTENT_TYPE = "application/json";

export function* compareReqBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
  config: Config,
): Iterable<Result> {
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

  const requestContentType = requestHeaders.get("content-type") || "";
  const contentType = requestContentType
    ? findMatchingType(requestContentType, availableRequestContentTypes) ||
      requestContentType
    : DEFAULT_CONTENT_TYPE;

  const bodyParameter = (operation.parameters || []).find(
    (p: OpenAPIV2.ParameterObject) => p.in === "body",
  );
  const schema: SchemaObject | undefined =
    getByContentType(
      dereferenceOas(operation.requestBody || {}, oas)?.content,
      contentType,
    )?.schema || dereferenceOas(bodyParameter || {}, oas)?.schema;

  const required =
    dereferenceOas(operation.requestBody || {}, oas)?.required ||
    dereferenceOas(bodyParameter || {}, oas)?.required;
  if (!required && !body) {
    return;
  }

  if (
    schema &&
    canValidate(contentType, config.get("disableMultipartFormdata")!) &&
    isValidRequest(interaction) &&
    (config.get("noValidateRequestBodyUnlessApplicationJson")
      ? !!findMatchingType("application/json", availableRequestContentTypes)
      : true)
  ) {
    const value = parseBody(
      body,
      requestContentType,
      config.get("legacyParser")!,
    );
    const schemaId = `[root].paths.${path}.${method}.requestBody.content.${contentType}`;
    const validate = getValidateFunction(ajv, schemaId, () =>
      transformRequestSchema(minimumSchema(schema, oas)),
    );
    if (!validate(value)) {
      for (const error of validate.errors!) {
        yield {
          code: "request.body.incompatible",
          message: `Request body is incompatible with the request body schema in the spec file: ${formatMessage(error)}`,
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].request.body${formatInstancePath(error)}`,
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

  if (
    !!body &&
    !schema &&
    isValidRequest(interaction) &&
    (config.get("noValidateRequestBodyUnlessApplicationJson")
      ? !!findMatchingType("application/json", availableRequestContentTypes) ||
        availableRequestContentTypes.length === 0
      : true)
  ) {
    yield {
      code: "request.body.unknown",
      message: "No matching schema found for request body",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].request.body`,
        value: get(interaction, "request.body"),
      },
      specDetails: {
        location: `[root].paths.${path}.${method}.requestBody.content`,
        pathMethod: method,
        pathName: path,
        value: get(operation, "requestBody.content"),
      },
      type: "error",
    };
  }
}
