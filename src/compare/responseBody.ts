import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Result } from "../results";
import { transformResponseSchema } from "../transform";

export function compareResBody(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction,
): Partial<Result>[] {
  const { operation, path } = route.store;
  const results: Partial<Result>[] = [];

  const { body, status } = interaction.response;
  const headers = new Headers(interaction.request.headers);
  const contentType: string = headers.get("accept")?.split(";")[0];

  const response = operation.responses[status] as OpenAPIV3.ResponseObject;
  if (!response) {
    results.push({
      code: "response.status.unknown",
      message: `Response status code not defined in spec file: ${status}`,
      type: "error",
    });
  }
  if (!response && contentType) {
    results.push({
      code: "request.accept.unknown",
      message:
        "Request Accept header is defined but the spec does not specify any mime-types to produce",
      type: "warning",
    });
  }
  if (response && !response.content) {
    results.push({
      code: "response.content-type.unknown",
      message:
        "Response Content-Type header is defined but the spec does not specify any mime-types to produce",
      type: "warning",
    });
  }

  if (response && response.content) {
    const schema = response.content[contentType]?.schema;
    if (schema && body) {
      const schemaId = `response-${path}-${status}-${contentType}`;
      let validate = ajv.getSchema(schemaId);
      if (!validate) {
        ajv.addSchema(transformResponseSchema(schema), schemaId);
        validate = ajv.getSchema(schemaId);
      }
      if (!validate(body)) {
        results.push(...validate.errors);
      }
    }
  }

  return results;
}
