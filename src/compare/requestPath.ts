/* eslint-disable */
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Result } from "../results";

export function* compareReqPath(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
): Iterable<Result> {
  const { components, method, operation, path } = route.store;

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
      for (const error of validate.errors) {
        // yield {};
      }
    }
  }
}
