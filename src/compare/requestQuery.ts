import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { Result } from "../results";
import type { Interaction } from "../documents/pact";
import { get } from "lodash-es";
import {
  baseMockDetails,
  formatErrorMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results";

export function* compareReqQuery(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { components, method, operation, path } = route.store;

  const searchParams = Object.assign({}, route.searchParams);

  for (const [parameterIndex, parameter] of (
    operation.parameters || []
  ).entries()) {
    if (parameter.in !== "query") {
      continue;
    }
    const schema: SchemaObject = parameter.schema;
    const value = searchParams[parameter.name];
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
            code: "request.query.incompatible",
            message: `Value is incompatible with the parameter defined in the spec file: ${message}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].request.query.${parameter.name}.${instancePath}`,
              value: instancePath ? get(value, instancePath) : value,
            },
            source: "spec-mock-validation",
            specDetails: {
              location: `${schemaId}.schema.${schemaPath}`,
              pathMethod: method,
              pathName: path,
              value: get(validate.schema, schemaPath),
            },
            type: "error",
          };
        }
      }
    }

    delete searchParams[parameter.name];
  }

  for (const [key, value] of Object.entries(searchParams)) {
    yield {
      code: "request.query.unknown",
      message: `Query parameter is not defined in the spec file: ${key}`,
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}].request.query.${key}`,
        value: value,
      },
      specDetails: {
        location: `[root].paths.${path}.${method}`,
        pathMethod: method,
        pathName: path,
        value: operation,
      },
      type: "warning",
    };
  }
}
