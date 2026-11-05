import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get, omit } from "lodash-es";

import type { HttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import {
  baseMockDetails,
  formatInstancePath,
  formatMessage,
  formatSchemaPath,
} from "#results/index";
import { minimumSchema } from "#transform/index";
import type { Config } from "#utils/config";
import { isSimpleSchema } from "#utils/quirks";
import { dereferenceOas, splitPath } from "#utils/schema";
import { getValidateFunction } from "#utils/validation";

import { cleanPathParameter } from "./utils/parameters";
import { parseValue } from "./utils/parse";

export function* compareReqPath(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: HttpInteraction,
  index: number,
  config: Config,
): Iterable<Result> {
  const { method, oas, operation, path } = route.store;

  for (const [parameterIndex, parameter] of (
    operation.parameters || []
  ).entries()) {
    if (parameter.in !== "path") {
      continue;
    }

    const dereferencedParameter = dereferenceOas(parameter, oas);
    const schema: SchemaObject =
      dereferencedParameter.schema ||
      omit(dereferencedParameter, ["name", "in", "description", "required"]);
    const value =
      schema?.type === "string"
        ? route.params[cleanPathParameter(dereferencedParameter.name)]
        : parseValue(
            route.params[cleanPathParameter(dereferencedParameter.name)],
          );

    // ignore when OAS has unused parameter in the operation parameters
    if (!(cleanPathParameter(dereferencedParameter.name) in route.params)) {
      continue;
    }

    if (schema) {
      const schemaId = `[root].paths.${path}.${method}.parameters[${parameterIndex}]`;
      const validate = getValidateFunction(ajv, schemaId + !!value, () =>
        config.get("no-validate-complex-parameters") &&
        isSimpleSchema(schema, oas) &&
        value
          ? {}
          : minimumSchema(schema, oas),
      );

      let separator = ",";
      if (parameter.style?.toLowerCase() === "label" && parameter.explode) {
        separator = ".";
      }
      if (parameter.style?.toLowerCase() === "matrix" && parameter.explode) {
        separator = ";";
      }
      if (
        !validate(
          schema.type === "array" && typeof value === "string"
            ? value.split(separator)
            : value,
        )
      ) {
        for (const error of validate.errors!) {
          yield {
            code: "request.path-parameter.incompatible",
            message: `Value is incompatible with path parameter "${dereferencedParameter.name}${formatInstancePath(error)}" of ${method.toUpperCase()} ${path} defined in the spec file: ${formatMessage(error)}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].request.path`,
              value: get(interaction, "request.path"),
            },
            specDetails: {
              location: `${schemaId}.schema.${formatSchemaPath(error)}`,
              pathMethod: method,
              pathName: path,
              value: get(validate.schema, splitPath(error.schemaPath)),
            },
            type: "error",
          };
        }
      }
    }
  }
}
