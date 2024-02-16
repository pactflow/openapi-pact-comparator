import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { baseMockDetails } from "../formatters";

const standardHttpRequestHeaders = [
  "accept",
  "accept-charset",
  "accept-datetime",
  "accept-encoding",
  "accept-language",
  "authorization",
  "cache-control",
  "connection",
  "content-length",
  "content-md5",
  "content-type",
  "cookie",
  "date",
  "expect",
  "forwarded",
  "from",
  "host",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "max-forwards",
  "origin",
  "pragma",
  "proxy-authorization",
  "range",
  "referer",
  "te",
  "upgrade",
  "user-agent",
  "via",
  "warning",
];

export function* compareReqHeader(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { method, operation, path, securitySchemes } = route.store;

  const { status } = interaction.response;
  const headers = new Headers(interaction.request.headers);

  let requestContentType: string = headers.get("accept")?.split(";")[0];
  if (
    !Object.values(operation.responses).some(
      (r: OpenAPIV3.ResponseObject) => r?.content,
    ) &&
    requestContentType
  ) {
    yield {
      code: "request.accept.unknown",
      message:
        "Request Accept header is defined but the spec does not specify any mime-types to produce",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].request.headers.Accept`,
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

  let responseContentType: string = new Headers(interaction.response.headers)
    .get("content-type")
    ?.split(";")[0];
  if (!operation.responses[status]?.content && responseContentType) {
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
  }

  // ignore standard headers
  for (const key of standardHttpRequestHeaders) {
    headers.delete(key);
  }

  for (const key in securitySchemes) {
    const scheme = securitySchemes[key];
    if (
      scheme.in === "header" &&
      (operation.security || []).some(
        (s: OpenAPIV3.SecuritySchemeObject) => !!s[scheme.name],
      )
    ) {
      headers.delete(scheme.name);
    }
  }

  for (const parameter of (
    operation.parameters as OpenAPIV3.ParameterObject[]
  ).filter((p) => p.in === "header")) {
    // FIXME: validate headers

    headers.delete(parameter.name);
  }

  for (const key in interaction.request.headers) {
    if (headers.has(key)) {
      yield {
        code: "request.header.unknown",
        message: `Request header is not defined in the spec file: ${key}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.headers.${key}`,
          value: String(headers.get(key)),
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
