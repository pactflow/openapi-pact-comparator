import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { get } from "lodash-es";
import {
  baseMockDetails,
  formatErrorMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results";

export function* compareReqPath(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { components, method, operation, path } = route.store;

  for (const [parameterIndex, parameter] of operation.parameters.entries()) {
    if (parameter.in !== "path") {
      continue;
    }

    const schema: SchemaObject = parameter.schema;
    const value = route.params[parameter.name];
    if (value && schema) {
      schema.components = components;
      const schemaId = `[root].paths.${path}.${method}.parameters[${parameterIndex}]`;
      let validate = ajv.getSchema(schemaId);
      if (!validate) {
        ajv.addSchema(schema, schemaId);
        validate = ajv.getSchema(schemaId);
      }
      if (!validate(value)) {
        for (const error of validate.errors) {
          const message = formatErrorMessage(error);
          const instancePath = formatInstancePath(error.instancePath);
          const schemaPath = formatSchemaPath(error.schemaPath);

          yield {
            code: "request.path-or-method.unknown",
            message: `Path or method not defined in spec file: ${parameter.name} ${message}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].request.path`,
              value: instancePath ? get(value, instancePath) : value,
            },
            specDetails: {
              location: `${schemaId}.schema.${schemaPath}`,
              pathMethod: method,
              pathName: path,
              value: operation,
            },
            type: "error",
          };
        }
      }
    }
  }
}
