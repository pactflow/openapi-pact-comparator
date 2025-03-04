import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get } from "lodash-es";

import type { Interaction } from "../documents/pact";
import type { Result } from "../results/index";
import { baseMockDetails } from "../results/index";
import { minimumSchema } from "../transform/index";
import { dereferenceOas } from "../utils/schema";
import { getValidateFunction } from "../utils/validation";
import { cleanPathParameter } from "./utils/parameters";
import { parseValue } from "./utils/parse";

export function* compareReqPath(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Result> {
  const { method, oas, operation, path } = route.store;

  for (const [parameterIndex, parameter] of (
    operation.parameters || []
  ).entries()) {
    if (parameter.in !== "path") {
      continue;
    }

    const dereferencedParameter = dereferenceOas(parameter, oas);
    const schema: SchemaObject = dereferencedParameter.schema || {
      type: dereferencedParameter.type,
    };
    const value = parseValue(
      route.params[cleanPathParameter(dereferencedParameter.name)],
    );

    if (schema) {
      const schemaId = `[root].paths.${path}.${method}.parameters[${parameterIndex}]`;
      const validate = getValidateFunction(ajv, schemaId, () =>
        minimumSchema(schema, oas),
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
