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
import { findMatchingType, standardHttpRequestHeaders } from "./utils/content";

export function* compareReqHeader(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { components, method, operation, path, securitySchemes } = route.store;

  const availableRequestContentType = Object.keys(
    operation.requestBody?.content || {},
  );
  const availableResponseContentType = Object.values(operation.responses || {})
    .map((r: OpenAPIV3.ResponseObject) => r.content || {})
    .map((c) => Object.keys(c))
    .flat();

  // request accept
  // --------------
  const requestHeaders = new Headers(interaction.request.headers);
  const requestAccept: string =
    requestHeaders.get("accept")?.split(";")[0] || "";
  if (requestAccept) {
    if (availableResponseContentType.length === 0) {
      yield {
        code: "request.accept.unknown",
        message:
          "Request Accept header is defined but the spec does not specify any mime-types to produce",
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.headers.Accept`,
          value: requestAccept,
        },
        specDetails: {
          location: `[root].paths.${path}.${method}`,
          pathMethod: method,
          pathName: path,
          value: operation,
        },
        type: "warning",
      };
    } else if (!findMatchingType(requestAccept, availableResponseContentType)) {
      yield {
        code: "request.accept.incompatible",
        message:
          "Request Accept header is incompatible with the mime-types the spec defines to produce",
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.headers.Accept`,
          value: requestAccept,
        },
        specDetails: {
          location: `[root].paths.${path}.${method}`,
          pathMethod: method,
          pathName: path,
          value: operation,
        },
        type: "error",
      };
    }
  }

  // request content-type
  // --------------------
  const requestContentType: string =
    requestHeaders.get("content-type")?.split(";")[0] || "";
  if (requestContentType) {
    if (availableRequestContentType.length === 0) {
      yield {
        code: "request.content-type.unknown",
        message:
          "Request content-type header is defined but the spec does not specify any mime-types to consume",
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.headers.Content-Type`,
          value: requestContentType,
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
      !findMatchingType(requestContentType, availableRequestContentType)
    ) {
      yield {
        code: "request.content-type.incompatible",
        message:
          "Request Content-Type header is incompatible with the mime-types the spec accepts to consume",
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.headers.Content-Type`,
          value: requestContentType,
        },
        specDetails: {
          location: `[root].paths.${path}.${method}`,
          pathMethod: method,
          pathName: path,
          value: operation,
        },
        type: "error",
      };
    }
  } else {
    if (availableRequestContentType.length) {
      yield {
        code: "request.content-type.missing",
        message:
          "Request content type header is not defined but spec specifies mime-types to consume",
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.headers.ContentType`,
          value: requestContentType,
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
  }

  // ignored headers
  // ---------------
  for (const key of standardHttpRequestHeaders) {
    requestHeaders.delete(key);
  }
  for (const key in securitySchemes) {
    const scheme = securitySchemes[key];
    if (
      scheme.in === "header" &&
      (operation.security || []).some(
        (s: OpenAPIV3.SecuritySchemeObject) => !!s[scheme.name],
      )
    ) {
      requestHeaders.delete(scheme.name);
    }
  }

  // other headers
  // -------------
  for (const parameter of (
    operation.parameters as OpenAPIV3.ParameterObject[]
  ).filter((p) => p.in === "header")) {
    const schema: SchemaObject = parameter.schema;
    const value = requestHeaders.get(parameter.name);
    if (value && schema) {
      schema.components = components;
      const schemaId = `request-header-${method}-${path}-${parameter.name}`;
      let validate = ajv.getSchema(schemaId);
      if (!validate) {
        ajv.addSchema(schema, schemaId);
        validate = ajv.getSchema(schemaId);
      }
      if (!validate(value)) {
        for (const error of validate.errors) {
          const message = formatErrorMessage(error);
          const instancePath = formatInstancePath(error.instancePath);
          const schemaPath = formatSchemaPath(error.schemaPath);

          yield {
            code: "request.header.incompatible",
            message: `Value is incompatible with the parameter defined in the spec file: ${message}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].request.headers.${parameter.name}.${instancePath}`,
              value: instancePath ? get(value, instancePath) : value,
            },
            specDetails: {
              location: `[root].paths.${path}.${method}.${parameter.name}.schema.${schemaPath}`,
              pathMethod: method,
              pathName: path,
              value: get(validate.schema, schemaPath),
            },
            type: "error",
          };
        }
      }

      requestHeaders.delete(parameter.name);
    }
  }

  for (const [key, value] of requestHeaders.entries()) {
    yield {
      code: "request.header.unknown",
      message: `Request header is not defined in the spec file: ${key}`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].request.headers.${key}`,
        value: value,
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
}
