import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { baseMockDetails } from "../results";
import { findMatchingType } from "./utils/content";

export function* compareResHeader(
  _ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { method, operation, path } = route.store;

  const availableResponseContentType = Object.values(operation.responses || {})
    .map((r: OpenAPIV3.ResponseObject) => r.content || {})
    .map((c) => Object.keys(c))
    .flat();

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
}
