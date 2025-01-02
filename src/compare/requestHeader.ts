import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { baseMockDetails } from "../results";
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

  // response content-type
  // ---------------------
  const responseHeaders = new Headers(interaction.response.headers);
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
          location: `[root].interactions[${index}].response.headers.Content-Type`,
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
          location: `[root].interactions[${index}].response.headers.Content-Type`,
          value: responseContentType,
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

  // ignore standard headers
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

  for (const parameter of (
    operation.parameters as OpenAPIV3.ParameterObject[]
  ).filter((p) => p.in === "header")) {
    // FIXME: validate headers

    requestHeaders.delete(parameter.name);
  }

  for (const key in interaction.request.headers) {
    if (requestHeaders.has(key)) {
      yield {
        code: "request.header.unknown",
        message: `Request header is not defined in the spec file: ${key}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.headers.${key}`,
          value: String(requestHeaders.get(key)),
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
