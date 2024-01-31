import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Interaction } from "../documents/pact";
import type { Result } from "../results";
import { transformRequestSchema } from "../transform";

export function* compareReqBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
): Iterable<Result> {
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
            // yield {}
          }
        }
      }
    }
  }
}
