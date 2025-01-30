import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get } from "lodash-es";

import type { Interaction } from "../documents/pact.js";
import type { Result } from "../results/index.js";
import {
  baseMockDetails,
  formatErrorMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results/index.js";
import { minimumSchema } from "../transform/index.js";
import {
  findMatchingType,
  standardHttpResponseHeaders,
} from "./utils/content.js";
import { dereferenceOas } from "./utils/schema.js";

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

  // response content-type
  // ---------------------
  const responseHeaders = new Headers(
    interaction.response.headers as Record<string, string>,
  );
  const responseContentType =
    responseHeaders.get("content-type")?.split(";")[0] || "";
  if (responseContentType) {
    if (availableResponseContentType.length === 0) {
      yield {
        code: "response.content-type.unknown",
        message:
          "Response Content-Type header is defined but the spec does not specify any mime-types to produce",
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].response.headers.content-type`,
          value: responseContentType,
        },
        specDetails: {
          location: `[root].paths.${path}.${method}`,
          pathMethod: method,
          pathName: path,
          value: operation,
        },
        type: "warning",
      };
    } else if (
      !findMatchingType(responseContentType, availableResponseContentType)
    ) {
      yield {
        code: "response.content-type.incompatible",
        message:
          "Response Content-Type header is incompatible with the mime-types the spec defines to produce",
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].response.headers.content-type`,
          value: responseContentType,
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
          value: interaction.request.headers,
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

  // other headers
  // -------------
  const headers =
    dereferenceOas(operation.responses[interaction.response.status] || {}, oas)
      ?.headers || {};
  for (const headerName in headers) {
    const schema: SchemaObject =
      headers[headerName].schema || headers[headerName];
    const value = responseHeaders.get(headerName);
    if (value && schema) {
      const schemaId = `[root].paths.${path}.${method}.responses.${interaction.response.status}.headers.${headerName}`;
      let validate = ajv.getSchema(schemaId);
      if (!validate) {
        ajv.addSchema(minimumSchema(schema, oas), schemaId);
        validate = ajv.getSchema(schemaId);
      }
      if (!validate!(value)) {
        for (const error of validate!.errors!) {
          const message = formatErrorMessage(error);
          const instancePath = formatInstancePath(error.instancePath);
          const schemaPath = formatSchemaPath(error.schemaPath);

          yield {
            code: "response.header.incompatible",
            message: `Value is incompatible with the parameter defined in the spec file: ${message}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].response.headers.${headerName}.${instancePath}`,
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
    responseHeaders.delete(headerName);
  }

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
