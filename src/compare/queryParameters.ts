import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";

export function compareQueryParameters(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
) {
  const { operation, path } = route.store;
  const errors = [];
  const warnings = [];

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
        errors.push(...validate.errors);
      } else {
        if (route.searchParams[parameter.name]) {
          warnings.push(...validate.errors);
        }
      }
    }
  }

  return { errors, warnings };
}

