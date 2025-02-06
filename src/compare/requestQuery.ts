import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get } from "lodash-es";
import qs from "qs";

import type { Result } from "../results/index";
import type { Interaction } from "../documents/pact";
import {
  baseMockDetails,
  formatMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results/index";
import { minimumSchema } from "../transform/index";
import { dereferenceOas, splitPath } from "../utils/schema";
import { getValidateFunction } from "../utils/validation";

export function* compareReqQuery(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Result> {
  const { method, oas, operation, path, securitySchemes } = route.store;

  // TODO: parse different parameters differently?
  const searchParams = qs.parse(route.searchParams, {
    allowDots: true,
    comma: true,
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
    const value = searchParams[dereferencedParameter.name];
    if (interaction.response.status < 400) {
      if (schema && (value || dereferencedParameter.required)) {
        const schemaId = `[root].paths.${path}.${method}.parameters[${parameterIndex}]`;
        const validate = getValidateFunction(ajv, schemaId, () =>
          minimumSchema(schema, oas),
        );
        if (!validate(value)) {
          for (const error of validate.errors!) {
            yield {
              code: "request.query.incompatible",
              message: `Value is incompatible with the parameter defined in the spec file: ${formatMessage(error)}`,
              mockDetails: {
                ...baseMockDetails(interaction),
                location: `[root].interactions[${index}].request.query.${dereferencedParameter.name}.${formatInstancePath(error)}`,
                value: error.instancePath
                  ? get(value, splitPath(error.instancePath))
                  : value,
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
      delete searchParams[dereferencedParameter.name];
    }
  }

  if (interaction.response.status < 400) {
    for (const scheme of operation.security || []) {
      for (const schemeName of Object.keys(scheme)) {
        const scheme = securitySchemes[schemeName];
        switch (scheme.type) {
          case "apiKey":
            switch (scheme.in) {
              case "query":
                if (!searchParams[scheme.name]) {
                  yield {
                    code: "request.authorization.missing",
                    message:
                      "Request Authorization query is missing but is required by the spec file",
                    mockDetails: {
                      ...baseMockDetails(interaction),
                      location: `[root].interactions[${index}].request.query`,
                      value: get(interaction, "request.query"),
                    },
                    specDetails: {
                      location: `[root].paths.${path}.${method}`,
                      pathMethod: method,
                      pathName: path,
                      value: operation,
                    },
                    type: "error",
                  };
                }
                delete searchParams[scheme.name];
                break;
              case "cookie":
              case "header":
              // ignore
            }
            break;
          case "http":
            switch (scheme.scheme) {
              case "basic":
              case "bearer":
              // ignore
            }
            break;
          case "mutualTLS":
          case "oauth2":
          case "openIdConnect":
          // ignore
        }
      }
    }
  }

  if (interaction.response.status < 400) {
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
}
