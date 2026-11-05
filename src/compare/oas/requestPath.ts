import type { ErrorObject, SchemaObject, ValidateFunction } from "ajv";
import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { HTTPMethod } from "find-my-way";
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

import { findOtherRoutes } from "./setup";
import { cleanPathParameter } from "./utils/parameters";
import { parseValue } from "./utils/parse";

interface PathParameterFailure {
  error: ErrorObject;
  name: string;
  schemaId: string;
  validate: ValidateFunction;
}

function* findPathParameterFailures(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  config: Config,
): Generator<PathParameterFailure> {
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
            error,
            name: dereferencedParameter.name,
            schemaId,
            validate,
          };
        }
      }
    }
  }
}

export function* compareReqPath(
  ajv: Ajv,
  router: Router.Instance<Router.HTTPVersion.V1>,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  url: string,
  interaction: HttpInteraction,
  index: number,
  config: Config,
): Iterable<Result> {
  const { method, operation, path } = route.store;

  const failures = Array.from(findPathParameterFailures(ajv, route, config));
  if (!failures.length) {
    return;
  }

  // The router commits to its most specific route, so the interaction fails even
  // when another route accepts it. A parameter error would blame the wrong route.
  const hasValidOtherRoute = findOtherRoutes(
    router,
    interaction.request.method.toUpperCase() as HTTPMethod,
    url,
    route.store,
  ).some((other) => findPathParameterFailures(ajv, other, config).next().done);

  for (const { error, name, schemaId, validate } of failures) {
    yield hasValidOtherRoute
      ? {
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
        }
      : {
          code: "request.path-parameter.incompatible",
          message: `Value is incompatible with path parameter "${name}${formatInstancePath(error)}" of ${method.toUpperCase()} ${path} defined in the spec file: ${formatMessage(error)}`,
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
