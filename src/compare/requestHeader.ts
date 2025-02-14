import type { OpenAPIV3 } from "openapi-types";
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
import { isValidRequest } from "../utils/interaction";
import { dereferenceOas, splitPath } from "../utils/schema";
import { getValidateFunction } from "../utils/validation";
import { findMatchingType, standardHttpRequestHeaders } from "./utils/content";
import { parseValue } from "./utils/parse";

export function* compareReqHeader(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Result> {
  const { method, oas, operation, path, securitySchemes } = route.store;
  const { body } = interaction.request;
  const availableRequestContentType =
    operation.consumes ||
    Object.keys(
      dereferenceOas(operation.requestBody || {}, oas)?.content || {},
    );
  const allAvailableResponseContentTypes =
    operation.produces ||
    Object.entries(operation.responses).reduce(
      (acc: string[], [_status, response]) => {
        return [
          ...acc,
          ...Object.keys(dereferenceOas(response || {}, oas)?.content || {}),
        ];
      },
      [],
    );
  const availableResponseContentType =
    operation.produces ||
    Object.keys(
      dereferenceOas(
        operation.responses[interaction.response.status] || {},
        oas,
      )?.content || {},
    );
  const requestHeaders = new Headers(
    interaction.request.headers as Record<string, string>,
  );

  // request accept
  // --------------
  const requestAccept: string =
    requestHeaders.get("accept")?.split(";")[0] || "";

  if (requestAccept && !allAvailableResponseContentTypes.length) {
    yield {
      code: "request.accept.unknown",
      message:
        "Request Accept header is defined but the spec does not specify any mime-types to produce",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].request.headers.accept`,
        value: requestHeaders.get("accept"),
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
    requestAccept &&
    availableResponseContentType.length &&
    !findMatchingType(requestAccept, availableResponseContentType)
  ) {
    yield {
      code: "request.accept.incompatible",
      message:
        "Request Accept header is incompatible with the mime-types the spec defines to produce",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].request.headers.accept`,
        value: requestHeaders.get("accept"),
      },
      specDetails: {
        location: `[root].paths.${path}.${method}`,
        pathMethod: method,
        pathName: path,
        value: availableResponseContentType,
      },
      type: "error",
    };
  }

  // request content-type
  // --------------------
  const requestContentType: string =
    requestHeaders.get("content-type")?.split(";")[0] || "";

  if (
    requestContentType &&
    !availableRequestContentType.length &&
    isValidRequest(interaction)
  ) {
    yield {
      code: "request.content-type.unknown",
      message:
        "Request content-type header is defined but the spec does not specify any mime-types to consume",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].request.headers.content-type`,
        value: requestHeaders.get("content-type"),
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
    requestContentType &&
    availableRequestContentType.length &&
    !findMatchingType(requestContentType, availableRequestContentType)
  ) {
    yield {
      code: "request.content-type.incompatible",
      message:
        "Request Content-Type header is incompatible with the mime-types the spec accepts to consume",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].request.headers.content-type`,
        value: requestHeaders.get("content-type"),
      },
      specDetails: {
        location: `[root].paths.${path}.${method}.requestBody.content`,
        pathMethod: method,
        pathName: path,
        value: availableRequestContentType,
      },
      type: "error",
    };
  }

  if (!requestContentType && availableRequestContentType.length && !!body) {
    yield {
      code: "request.content-type.missing",
      message:
        "Request content type header is not defined but spec specifies mime-types to consume",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].request.headers.content-type`,
        value: requestHeaders.get("content-type"),
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

  // security headers
  // ----------------
  if (isValidRequest(interaction)) {
    for (const scheme of operation.security || []) {
      for (const schemeName of Object.keys(scheme)) {
        const scheme = securitySchemes[schemeName];
        switch (scheme?.type) {
          case "apiKey":
            switch (scheme.in) {
              case "header":
                if (!requestHeaders.has(scheme.name)) {
                  yield {
                    code: "request.authorization.missing",
                    message:
                      "Request Authorization header is missing but is required by the spec file",
                    mockDetails: {
                      ...baseMockDetails(interaction),
                      location: `[root].interactions[${index}].request.headers`,
                      value: get(interaction, "request.headers"),
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
                requestHeaders.delete(scheme.name);
                break;
              case "cookie":
                // FIXME: handle cookies
                break;
              case "query":
              // ignore
            }
            break;
          case "basic": {
            const basicAuth = requestHeaders.get("authorization") || "";
            if (!basicAuth.startsWith("Basic ")) {
              yield {
                code: "request.authorization.missing",
                message:
                  "Request Authorization header is missing but is required by the spec file",
                mockDetails: {
                  ...baseMockDetails(interaction),
                  location: `[root].interactions[${index}].request.headers`,
                  value: get(interaction, "request.headers"),
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
            break;
          }
          case "http": {
            const auth = requestHeaders.get("authorization") || "";
            let isValid = false;
            switch (scheme.scheme) {
              case "basic":
                isValid = auth.startsWith("Basic ");
                break;
              case "bearer":
                isValid = auth.startsWith("Bearer ");
                break;
            }

            if (!isValid) {
              yield {
                code: "request.authorization.missing",
                message:
                  "Request Authorization header is missing but is required by the spec file",
                mockDetails: {
                  ...baseMockDetails(interaction),
                  location: `[root].interactions[${index}].request.headers`,
                  value: get(interaction, "request.headers"),
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
            break;
          }
          case "mutualTLS":
          case "oauth2":
          case "openIdConnect":
          // ignore
        }
      }
    }
  }

  // standard headers
  // ----------------
  for (const headerName of standardHttpRequestHeaders) {
    if (
      !(operation.parameters || []).find(
        (p: OpenAPIV3.ParameterObject) =>
          p.in === "header" &&
          p.name.toLowerCase() === headerName.toLowerCase(),
      )
    ) {
      requestHeaders.delete(headerName);
    }
  }

  // other headers
  // -------------
  for (const [parameterIndex, parameter] of (
    operation.parameters || []
  ).entries()) {
    if (parameter.in !== "header") {
      continue;
    }
    const dereferencedParameter = dereferenceOas(parameter, oas);
    const schema: SchemaObject = dereferencedParameter.schema || {
      type: dereferencedParameter.type,
    };
    const value = parseValue(requestHeaders.get(dereferencedParameter.name));

    if (value && schema && isValidRequest(interaction)) {
      const schemaId = `[root].paths.${path}.${method}.parameters[${parameterIndex}]`;
      const validate = getValidateFunction(ajv, schemaId, () =>
        minimumSchema(schema, oas),
      );
      if (!validate(value)) {
        for (const error of validate.errors!) {
          yield {
            code: "request.header.incompatible",
            message: `Value is incompatible with the parameter defined in the spec file: ${formatMessage(error)}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].request.headers.${dereferencedParameter.name}${formatInstancePath(error)}`,
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
      !value &&
      dereferencedParameter.required &&
      isValidRequest(interaction)
    ) {
      yield {
        code: "request.header.incompatible",
        message: `Value is incompatible with the parameter defined in the spec file: must have required property '${dereferencedParameter.name}'`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.headers.${dereferencedParameter.name}`,
          value,
        },
        specDetails: {
          location: `[root].paths.${path}.${method}.parameters[${parameterIndex}]`,
          pathMethod: method,
          pathName: path,
          value: dereferencedParameter,
        },
        type: "error",
      };
    }
    requestHeaders.delete(dereferencedParameter.name);
  }

  if (isValidRequest(interaction)) {
    for (const [headerName, headerValue] of requestHeaders.entries()) {
      yield {
        code: "request.header.unknown",
        message: `Request header is not defined in the spec file: ${headerName}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.headers.${headerName}`,
          value: headerValue,
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
}
