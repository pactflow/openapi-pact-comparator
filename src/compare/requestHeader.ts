import type { OpenAPIV3 } from "openapi-types";
import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { get } from "lodash-es";
import {
  baseMockDetails,
  formatErrorMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results";
import { minimumSchema } from "../transform";
import { findMatchingType, standardHttpRequestHeaders } from "./utils/content";
import { parseValue } from "./utils/parse";
import { dereferenceOas } from "./utils/schema";

export function* compareReqHeader(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { method, oas, operation, path, securitySchemes } = route.store;

  const availableRequestContentType =
    operation.consumes ||
    Object.keys(
      dereferenceOas(operation.requestBody || {}, oas)?.content || {},
    );
  const availableResponseContentType =
    operation.produces ||
    Object.keys(
      dereferenceOas(
        operation.responses[interaction.response.status] || {},
        oas,
      )?.content || {},
    );

  // request accept
  // --------------
  const requestHeaders = new Headers(
    interaction.request.headers as Record<string, string>,
  );
  const requestAccept: string =
    requestHeaders.get("accept")?.split(";")[0] || "";

  if (interaction.response.status < 400) {
    if (requestAccept) {
      if (availableResponseContentType.length === 0) {
        yield {
          code: "request.accept.unknown",
          message:
            "Request Accept header is defined but the spec does not specify any mime-types to produce",
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].request.headers.accept`,
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
      } else if (
        !findMatchingType(requestAccept, availableResponseContentType)
      ) {
        yield {
          code: "request.accept.incompatible",
          message:
            "Request Accept header is incompatible with the mime-types the spec defines to produce",
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].request.headers.accept`,
            value: requestAccept,
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
      requestHeaders.delete("accept");
    }
  }

  // request content-type
  // --------------------
  const requestContentType: string =
    requestHeaders.get("content-type")?.split(";")[0] || "";
  if (interaction.response.status < 400) {
    if (requestContentType) {
      if (availableRequestContentType.length === 0) {
        yield {
          code: "request.content-type.unknown",
          message:
            "Request content-type header is defined but the spec does not specify any mime-types to consume",
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].request.headers.content-type`,
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
            location: `[root].interactions[${index}].request.headers.content-type`,
            value: requestContentType,
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
      requestHeaders.delete("content-type");
    } else {
      if (availableRequestContentType.length) {
        yield {
          code: "request.content-type.missing",
          message:
            "Request content type header is not defined but spec specifies mime-types to consume",
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].request.headers.content-type`,
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
  }

  // security headers
  // ----------------
  if (interaction.response.status < 400) {
    for (const scheme of operation.security || []) {
      for (const schemeName of Object.keys(scheme)) {
        const scheme = securitySchemes[schemeName];
        switch (scheme.type) {
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
                      value: interaction.request.headers,
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
                requestHeaders.delete("cookie");
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
                  value: interaction.request.headers,
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
            requestHeaders.delete("authorization");
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
                  value: interaction.request.headers,
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
            requestHeaders.delete("authorization");
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
    if (interaction.response.status < 400) {
      if (value) {
        if (schema) {
          const schemaId = `[root].paths.${path}.${method}.parameters[${parameterIndex}]`;
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
                code: "request.header.incompatible",
                message: `Value is incompatible with the parameter defined in the spec file: ${message}`,
                mockDetails: {
                  ...baseMockDetails(interaction),
                  location: `[root].interactions[${index}].request.headers.${dereferencedParameter.name}.${instancePath}`,
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
      } else if (dereferencedParameter.required) {
        const message = `must have required property '${dereferencedParameter.name}'`;
        yield {
          code: "request.header.incompatible",
          message: `Value is incompatible with the parameter defined in the spec file: ${message}`,
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
    }
    requestHeaders.delete(dereferencedParameter.name);
  }

  if (interaction.response.status < 400) {
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
