import type { SchemaObject } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get } from "lodash-es";
import qs from "qs";

import type { Result } from "../results/index";
import type { Interaction } from "../documents/pact";
import {
  baseMockDetails,
  formatErrorMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../results/index";
import { minimumSchema } from "../transform/index";
import { dereferenceOas } from "./utils/schema";

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
        let validate = ajv.getSchema(schemaId);
        if (!validate) {
          ajv.addSchema(minimumSchema(schema, oas), schemaId);
          validate = ajv.getSchema(schemaId);
        }
        if (!validate!(value)) {
          for (const error of validate!.errors!) {
            const message = formatErrorMessage(error);
            const instancePath = formatInstancePath(error.instancePath);
            const schemaPath = formatSchemaPath(error.schemaPath);

            yield {
              code: "request.query.incompatible",
              message: `Value is incompatible with the parameter defined in the spec file: ${message}`,
              mockDetails: {
                ...baseMockDetails(interaction),
                location: `[root].interactions[${index}].request.query.${dereferencedParameter.name}.${instancePath}`,
                value: instancePath ? get(value, instancePath) : value,
              },
              specDetails: {
                location: `${schemaId}.schema.${schemaPath}`,
                pathMethod: method,
                pathName: path,
                value: get(validate!.schema, schemaPath),
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
                      value: interaction.request.query,
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
