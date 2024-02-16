import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { get } from "lodash-es";
import {
  baseMockDetails,
  formatErrorMessage,
  formatInstancePath,
  formatSchemaPath,
} from "../formatters";
import { transformRequestSchema } from "../transform";

export function* compareReqBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Partial<Result>> {
  const { operation, path } = route.store;

  const { body } = interaction.request;
  if (body) {
    const headers = new Headers(interaction.request.headers);
    const contentType: string = headers.get("content-type")?.split(";")[0];
    const request = operation.requestBody as OpenAPIV3.RequestBodyObject;
    if (request.content) {
      const schema = request.content[contentType]?.schema;
      if (schema) {
        const schemaId = `request-${path}-${contentType}`;
        let validate = ajv.getSchema(schemaId);
        if (!validate) {
          ajv.addSchema(transformRequestSchema(schema), schemaId);
          validate = ajv.getSchema(schemaId);
        }
        if (!validate(body)) {
          for (const error of validate.errors) {
            const method = interaction.request.method.toLowerCase();
            const message = formatErrorMessage(error);
            const instancePath = formatInstancePath(error.instancePath);
            const schemaPath = formatSchemaPath(error.schemaPath);

            yield {
              code: "request.body.incompatible",
              message: `Request body is incompatible with the request body schema in the spec file: ${message}`,
              mockDetails: {
                ...baseMockDetails(interaction),
                location: `[root].interactions[${index}].request.body.${instancePath}`,
                value: instancePath ? get(body, instancePath) : body,
              },
              specDetails: {
                location: `[root].paths.${path}.${method}.requestBody.content.${contentType}.schema.${schemaPath}`,
                pathMethod: method,
                pathName: path,
                value: get(validate.schema, schemaPath),
              },
              type: "error",
            };
          }
        }
      }
    }
  }
}
