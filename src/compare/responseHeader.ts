import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get } from "lodash-es";

import type { Interaction } from "../documents/pact";
import type { Result } from "../results/index";
import {
  baseMockDetails,
  formatMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results/index";
import { minimumSchema } from "../transform/index";
import { dereferenceOas, splitPath } from "../utils/schema";
import { getValidateFunction } from "../utils/validation";
import { findMatchingType, standardHttpResponseHeaders } from "./utils/content";

export function* compareResHeader(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Result> {
  const { method, oas, operation, path } = route.store;

  const availableResponseContentType =
    operation.produces ||
    Object.keys(
      dereferenceOas(
        operation.responses[interaction.response.status] || {},
        oas,
      )?.content || {},
    );
  const responseHeaders = new Headers(
    interaction.response.headers as Record<string, string>,
  );

  // no content response
  // -------------------
  if (interaction.response.status === 204) {
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-type");
  }

  // no response found
  // -----------------
  const response =
    operation.responses[interaction.response.status] ||
    operation.responses["default"];
  if (!response) {
    return;
  }

  // response content-type
  // ---------------------
  const responseContentType =
    responseHeaders.get("content-type")?.split(";")[0] || "";

  if (responseContentType && !availableResponseContentType.length) {
    yield {
      code: "response.content-type.unknown",
      message:
        "Response Content-Type header is defined but the spec does not specify any mime-types to produce",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].response.headers.content-type`,
        value: responseHeaders.get("content-type"),
      },
      specDetails: {
        location: `[root].paths.${path}.${method}`,
        pathMethod: method,
        pathName: path,
        value: operation,
      },
      type: "warning",
    };
  }

  if (
    responseContentType &&
    availableResponseContentType.length &&
    !findMatchingType(responseContentType, availableResponseContentType)
  ) {
    yield {
      code: "response.content-type.incompatible",
      message:
        "Response Content-Type header is incompatible with the mime-types the spec defines to produce",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].response.headers.content-type`,
        value: responseHeaders.get("content-type"),
      },
      specDetails: {
        location: `[root].paths.${path}.${method}.responses.${interaction.response.status}.content`,
        pathMethod: method,
        pathName: path,
        value: availableResponseContentType,
      },
      type: "error",
    };
  }
  responseHeaders.delete("content-type");

  // specified headers
  // -----------------
  const headers = dereferenceOas(response, oas)?.headers || {};
  for (const headerName in headers) {
    const schema: SchemaObject =
      dereferenceOas(headers[headerName], oas).schema || headers[headerName];
    const value = responseHeaders.get(headerName);
    if (value && schema) {
      const schemaId = `[root].paths.${path}.${method}.responses.${interaction.response.status}.headers.${headerName}`;
      const validate = getValidateFunction(ajv, schemaId, () =>
        minimumSchema(schema, oas),
      );
      if (!validate(value)) {
        for (const error of validate.errors!) {
          yield {
            code: "response.header.incompatible",
            message: `Value is incompatible with the parameter defined in the spec file: ${formatMessage(error)}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].response.headers.${headerName}${formatInstancePath(error)}`,
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
    responseHeaders.delete(headerName);
  }

  // standard headers
  // ----------------
  for (const headerName of standardHttpResponseHeaders) {
    if (responseHeaders.has(headerName)) {
      yield {
        code: "response.header.undefined",
        message: `Standard http response header is not defined in the spec file: ${headerName}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].response.headers.${headerName}`,
          value: get(interaction, "request.headers"),
        },
        specDetails: {
          location: `[root].paths.${path}.${method}`,
          pathMethod: method,
          pathName: path,
          value: operation,
        },
        type: "warning",
      };
    }
    responseHeaders.delete(headerName);
  }

  // remaining headers
  // -----------------
  for (const [headerName, headerValue] of responseHeaders.entries()) {
    yield {
      code: "response.header.unknown",
      message: `Response header is not defined in the spec file: ${headerName}`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].response.headers.${headerName}`,
        value: headerValue,
      },
      specDetails: {
        location: `[root].paths.${path}.${method}.responses.${interaction.response.status}.headers`,
        pathMethod: method,
        pathName: path,
        value: dereferenceOas(
          operation.responses[interaction.response.status] || {},
          oas,
        ).headers,
      },
      type: "error",
    };
  }
}
