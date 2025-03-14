import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get } from "lodash-es";
import qs from "qs";
import querystring from "node:querystring";

import type { Result } from "#results/index";
import type { Interaction } from "#documents/pact";
import {
  baseMockDetails,
  formatMessage,
  formatInstancePath,
  formatSchemaPath,
} from "#results/index";
import { minimumSchema } from "#transform/index";
import type { Config } from "#utils/config";
import { isValidRequest } from "#utils/interaction";
import { ARRAY_SEPARATOR } from "#utils/queryParams";
import { isSimpleSchema } from "#utils/quirks";
import { dereferenceOas, splitPath } from "#utils/schema";
import { getValidateFunction } from "#utils/validation";

export function* compareReqQuery(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
  config: Config,
): Iterable<Result> {
  const { method, oas, operation, path, securitySchemes } = route.store;

  const searchParamsParsed = config.get("legacy-parser")
    ? querystring.parse(route.searchParams as unknown as string)
    : qs.parse(route.searchParams, {
        allowDots: true,
        comma: true,
      });

  const searchParamsUnparsed = config.get("legacy-parser")
    ? querystring.parse(route.searchParams as unknown as string)
    : qs.parse(route.searchParams, {
        allowDots: false,
        comma: false,
      });

  for (const [parameterIndex, parameter] of (
    operation.parameters || []
  ).entries()) {
    const dereferencedParameter = dereferenceOas(parameter, oas);
    if (dereferencedParameter.in !== "query") {
      continue;
    }
    const schema: SchemaObject = dereferencedParameter.schema || {
      type: dereferencedParameter.type,
    };

    if (dereferencedParameter.schema?.type === "string") {
      searchParamsParsed[dereferencedParameter.name] =
        searchParamsUnparsed[dereferencedParameter.name];
    }

    const value = searchParamsParsed[dereferencedParameter.name];
    if (
      schema &&
      (value !== undefined || dereferencedParameter.required) &&
      isValidRequest(interaction)
    ) {
      const schemaId = `[root].paths.${path}.${method}.parameters[${parameterIndex}]`;
      const validate = getValidateFunction(ajv, schemaId, () =>
        config.get("no-validate-complex-parameters") &&
        isSimpleSchema(schema) &&
        value
          ? {}
          : minimumSchema(schema, oas),
      );

      let convertedValue =
        schema.type === "array" && typeof value === "string"
          ? value.split(ARRAY_SEPARATOR)
          : value;

      if (config.get("cast-objects-in-pact") && value === "[object Object]") {
        convertedValue = {};
      }

      if (!validate(convertedValue)) {
        for (const error of validate.errors!) {
          yield {
            code: "request.query.incompatible",
            message: `Value is incompatible with the parameter defined in the spec file: ${formatMessage(error)}`,
            mockDetails: {
              ...baseMockDetails(interaction),
              location: `[root].interactions[${index}].request.query.${dereferencedParameter.name}${formatInstancePath(error)}`,
              value: error.instancePath
                ? get(convertedValue, splitPath(error.instancePath))
                : convertedValue,
            },
            specDetails: {
              location: `${schemaId}.schema.${formatSchemaPath(error)}`,
              pathMethod: method,
              pathName: path,
              value: get(validate!.schema, splitPath(error.schemaPath)),
            },
            type: "error",
          };
        }
      }
    }
    delete searchParamsParsed[dereferencedParameter.name];
  }

  const securityQueries = [];
  if (isValidRequest(interaction)) {
    for (const scheme of operation.security || []) {
      for (const schemeName of Object.keys(scheme)) {
        const scheme = securitySchemes[schemeName];
        if (scheme?.type === "apiKey" && scheme?.in === "query") {
          securityQueries.push(scheme.name);
        }
      }
    }
  }

  if (isValidRequest(interaction)) {
    for (const [queryName, queryValue] of Object.entries(searchParamsParsed)) {
      if (!securityQueries.includes(queryName)) {
        yield {
          code: "request.query.unknown",
          message: `Query parameter is not defined in the spec file: ${queryName}`,
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].request.query.${queryName}`,
            value: queryValue,
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
  }
}
