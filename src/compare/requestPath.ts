import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { baseMockDetails } from "../results";
import { optimiseSchema } from "../transform";
import { cleanPathParameter } from "./utils/parameters";
import { parseValue } from "./utils/parse";

export function* compareReqPath(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { components, definitions, method, operation, path } = route.store;

  for (const [parameterIndex, parameter] of (
    operation.parameters || []
  ).entries()) {
    if (parameter.in !== "path") {
      continue;
    }

    const schema: SchemaObject = parameter.schema || { type: parameter.type };
    const value = parseValue(route.params[cleanPathParameter(parameter.name)]);
    if (value && schema) {
      const schemaId = `[root].paths.${path}.${method}.parameters[${parameterIndex}]`;
      let validate = ajv.getSchema(schemaId);
      if (!validate) {
        ajv.addSchema(
          optimiseSchema(schema, components, definitions),
          schemaId,
        );
        validate = ajv.getSchema(schemaId);
      }
      if (!validate(value)) {
        for (const _error of validate.errors) {
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
