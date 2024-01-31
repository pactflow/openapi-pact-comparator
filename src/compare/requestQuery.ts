import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Result } from "../results";
import { cloneDeep } from "lodash-es";

export function compareReqQuery(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction,
  index,
): Partial<Result>[] {
  const { method, operation, path } = route.store;
  const results: Partial<Result>[] = [];

  const searchParams = cloneDeep(route.searchParams);

  for (const parameter of (
    operation.parameters as OpenAPIV3.ParameterObject[]
  ).filter((p) => p.in === "query")) {
    const schemaId = `query-${path}-${parameter.name}`;
    let validate = ajv.getSchema(schemaId);
    if (!validate) {
      ajv.addSchema(parameter.schema, schemaId);
      validate = ajv.getSchema(schemaId);
    }

    if (!validate(searchParams[parameter.name])) {
      if (parameter.required) {
        results.push(...validate.errors);
      } else {
        if (searchParams[parameter.name]) {
          results.push(...validate.errors);
        }
      }
    }

    delete searchParams[parameter.name];
  }

  for (const key in searchParams) {
    results.push({
      code: "request.query.unknown",
      message: `Query parameter is not defined in the spec file: ${key}`,
      mockDetails: {
        interactionDescription: interaction.description,
        interactionState: interaction.providerState || "[none]",
        location: `[root].interactions[${index}].request.query.${key}`,
        mockFile: "pact.json",
        value: String(searchParams[key]),
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
