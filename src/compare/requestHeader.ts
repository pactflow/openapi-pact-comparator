import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Result } from "../results";
import { cloneDeep } from "lodash-es";

export function compareReqHeader(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction,
  index: number,
): Partial<Result>[] {
  const { method, operation, path } = route.store;
  const results: Partial<Result>[] = [];

  const headers = cloneDeep(interaction.request.headers);

  for (const parameter of (
    operation.parameters as OpenAPIV3.ParameterObject[]
  ).filter((p) => p.in === "header")) {
    // FIXME: validate headers

    delete headers[parameter.name];
  }

  delete headers["Authorization"]; // FIXME

  for (const key in headers) {
    results.push({
      code: "request.header.unknown",
      message: `Request header is not defined in the spec file: ${key}`,
      mockDetails: {
        interactionDescription: interaction.description,
        interactionState:
          interaction.providerState ||
          interaction.provider_state ||
          "[none]",
        location: `[root].interactions[${index}].request.headers.${key}`,
        mockFile: "pact.json",
        value: String(headers[key]),
      },
      source: "spec-mock-validation",
      specDetails: {
        location: `[root].paths.${path}.${method}`,
        pathMethod: method,
        pathName: path,
        specFile: "oas.yaml",
        value: operation,
      },
      type: "warning",
    });
  }
  return results;
}
