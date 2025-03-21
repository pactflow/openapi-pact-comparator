import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get, omit } from "lodash-es";

import type { Interaction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import { minimumSchema } from "#transform/index";
import type { Config } from "#utils/config";
import { dereferenceOas } from "#utils/schema";
import { isSimpleSchema } from "#utils/quirks";
import { getValidateFunction } from "#utils/validation";
import { cleanPathParameter } from "./utils/parameters";
import { parseValue } from "./utils/parse";

export function* compareReqPath(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
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
        for (const _error of validate.errors!) {
          yield {
            code: "request.path-or-method.unknown",
            message: `Path or method not defined in spec file: ${method.toUpperCase()} ${interaction.request.path}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].request.path`,
              value: get(interaction, "request.path"),
            },
            specDetails: {
              location: `[root].paths`,
              pathMethod: null,
              pathName: null,
              value: operation,
            },
            type: "error",
          };
        }
      }
    }
  }
}
