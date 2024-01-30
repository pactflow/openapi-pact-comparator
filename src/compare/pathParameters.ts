import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Result } from "../results";

export function comparePathParameters(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
): Partial<Result>[] {
  const { operation, path } = route.store;
  const results: Partial<Result>[] = [];

  for (const parameter of (
    operation.parameters as OpenAPIV3.ParameterObject[]
  ).filter((p) => p.in === "path")) {
    const schemaId = `path-${path}-${parameter.name}`;
    let validate = ajv.getSchema(schemaId);
    if (!validate) {
      ajv.addSchema(parameter.schema, schemaId);
      validate = ajv.getSchema(schemaId);
    }
    if (!validate(route.params[parameter.name])) {
      results.push(...validate.errors);
    }
  }

  return results;
}
