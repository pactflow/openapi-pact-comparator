import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Result } from "../results";

export function compareQueryParameters(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
): Partial<Result>[] {
  const { operation, path } = route.store;
  const results: Partial<Result>[] = [];

  for (const parameter of (
    operation.parameters as OpenAPIV3.ParameterObject[]
  ).filter((p) => p.in === "query")) {
    const schemaId = `query-${path}-${parameter.name}`;
    let validate = ajv.getSchema(schemaId);
    if (!validate) {
      ajv.addSchema(parameter.schema, schemaId);
      validate = ajv.getSchema(schemaId);
    }

    if (!validate(route.searchParams[parameter.name])) {
      if (parameter.required) {
        results.push(...validate.errors);
      } else {
        if (route.searchParams[parameter.name]) {
          results.push(...validate.errors);
        }
      }
    }
  }

  return results;
}
