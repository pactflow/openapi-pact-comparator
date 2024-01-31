import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Result } from "../results";
import type { Interaction } from "../documents/pact";

export function* compareReqQuery(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Result> {
  const { method, operation, path } = route.store;

  const searchParams = new URLSearchParams(route.searchParams);

  for (const parameter of (
    operation.parameters as OpenAPIV3.ParameterObject[]
  ).filter((p) => p.in === "query")) {
    // FIXME: validate query

    searchParams.delete(parameter.name);
  }

  for (const [key, value] of searchParams.entries()) {
    yield {
      code: "request.query.unknown",
      message: `Query parameter is not defined in the spec file: ${key}`,
      mockDetails: {
        interactionDescription: interaction.description,
        interactionState: interaction.providerState || "[none]",
        location: `[root].interactions[${index}].request.query.${key}`,
        mockFile: "pact.json",
        value: String(value),
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
    };
  }
}
