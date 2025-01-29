import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { baseMockDetails } from "../results";
import { minimumSchema } from "../transform";
import { cleanPathParameter } from "./utils/parameters";
import { parseValue } from "./utils/parse";
import { dereferenceOas } from "./utils/schema";

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
    if (value && schema) {
      const schemaId = `[root].paths.${path}.${method}.parameters[${parameterIndex}]`;
      let validate = ajv.getSchema(schemaId);
      if (!validate) {
        ajv.addSchema(minimumSchema(schema, oas), schemaId);
        validate = ajv.getSchema(schemaId);
      }
      if (!validate!(value)) {
        for (const _error of validate!.errors!) {
          yield {
            code: "request.path-or-method.unknown",
            message: `Path or method not defined in spec file: ${method.toUpperCase()} ${interaction.request.path}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].request.path`,
              value: interaction.request.path,
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
