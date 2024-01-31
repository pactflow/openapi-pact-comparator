import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Result } from "../results";
import { transformResponseSchema } from "../transform";
import { get } from "lodash-es";

const DEFAULT_CONTENT_TYPE = "application/json";

export function compareResBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction,
  index: number,
): Partial<Result>[] {
  const { method, operation, path } = route.store;
  const results: Partial<Result>[] = [];

  const { body, status } = interaction.response;
  const headers = new Headers(interaction.request.headers);
  let contentType: string = headers.get("accept")?.split(";")[0];

  const response = operation.responses[status] as OpenAPIV3.ResponseObject;
  if (!response) {
    results.push({
      code: "response.status.unknown",
      message: `Response status code not defined in spec file: ${status}`,
      mockDetails: {
        interactionDescription: interaction.description,
        interactionState:
          interaction.providerState ||
          interaction.provider_state ||
          "[none]",
        location: `[root].interactions[${index}].response.status`,
        mockFile: "pact.json",
        value: status,
      },
      source: "spec-mock-validation",
      specDetails: {
        location: `[root].paths.${path}.${method}.responses`,
        pathMethod: method,
        pathName: path,
        specFile: "oas.yaml",
        value: operation.responses,
      },
      type: "error",
    });
  }

  if (response && response.content) {
    contentType ||= DEFAULT_CONTENT_TYPE;
    const schema = response.content[contentType]?.schema;
    if (schema && body) {
      const schemaId = `response-${path}-${status}-${contentType}`;
      let validate = ajv.getSchema(schemaId);
      if (!validate) {
        ajv.addSchema(transformResponseSchema(schema), schemaId);
        validate = ajv.getSchema(schemaId);
      }
      if (!validate(body)) {
        results.push(
          ...validate.errors.map((error) => {
            const message =
              error.keyword === "additionalProperties"
                ? `${error.message} - ${error.params.additionalProperty}`
                : error.message;

            const instancePath = error.instancePath
              .replace(/\//g, ".")
              .substring(1);
            const schemaPath = error.schemaPath
              .replace(/\//g, ".")
              .substring(2);

            return {
              code: "response.body.incompatible",
              message: `Response body is incompatible with the response body schema in the spec file: ${message}`,
              mockDetails: {
                interactionDescription: interaction.description,
                interactionState:
                  interaction.providerState ||
                  interaction.provider_state ||
                  "[none]",
                location: [
                  "[root]",
                  `interactions[${index}]`,
                  "response",
                  "body",
                  instancePath,
                ]
                  .filter(Boolean)
                  .join("."),
                mockFile: "pact.json",
                value: instancePath ? get(body, instancePath) : body,
              },
              source: "spec-mock-validation",
              specDetails: {
                location: `[root].paths.${path}.${method}.responses.${status}.content.${contentType}.schema.${schemaPath}`,
                pathMethod: method,
                pathName: path,
                specFile: "oas.yaml",
                value: get(validate.schema, schemaPath),
              },
              type: "error",
            } as Result;
          }),
        );
      }
    }
  }

  return results;
}
