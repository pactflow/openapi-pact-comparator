import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import type { Result } from "../results";
import { cloneDeep } from "lodash-es";

export function compareReqHeader(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction,
  index: number,
): Partial<Result>[] {
  const { method, operation, path } = route.store;
  const results: Partial<Result>[] = [];

  const { status } = interaction.response;
  const headers = cloneDeep(interaction.request.headers);

  let requestContentType: string = new Headers(interaction.request.headers)
    .get("accept")
    ?.split(";")[0];
  if (
    !Object.values(operation.responses).some(
      (r: OpenAPIV3.ResponseObject) => r?.content,
    ) &&
    requestContentType
  ) {
    results.push({
      code: "request.accept.unknown",
      message:
        "Request Accept header is defined but the spec does not specify any mime-types to produce",
      mockDetails: {
        interactionDescription: interaction.description,
        interactionState:
          interaction.providerState || interaction.provider_state || "[none]",
        location: `[root].interactions[${index}].request.headers.Accept`,
        mockFile: "pact.json",
        value: requestContentType,
      },
      source: "spec-mock-validation",
      specDetails: {
        location: `[root].paths.${path}.${method}`,
        pathMethod: method,
        pathName: path,
        specFile: "oas.yaml",
        value: operation,
      },
      type: "warning",
    });
  }
  delete headers["Accept"];

  let responseContentType: string = new Headers(interaction.response.headers)
    .get("content-type")
    ?.split(";")[0];
  if (!operation.responses[status]?.content && responseContentType) {
    results.push({
      code: "response.content-type.unknown",
      message:
        "Response Content-Type header is defined but the spec does not specify any mime-types to produce",
      mockDetails: {
        interactionDescription: interaction.description,
        interactionState:
          interaction.providerState || interaction.provider_state || "[none]",
        location: `[root].interactions[${index}].response.headers.Content-Type`,
        mockFile: "pact.json",
        value: responseContentType,
      },
      source: "spec-mock-validation",
      specDetails: {
        location: `[root].paths.${path}.${method}`,
        pathMethod: method,
        pathName: path,
        specFile: "oas.yaml",
        value: operation,
      },
      type: "warning",
    });
  }
  delete headers["Content-Type"];

  delete headers["Authorization"]; // FIXME

  for (const parameter of (
    operation.parameters as OpenAPIV3.ParameterObject[]
  ).filter((p) => p.in === "header")) {
    // FIXME: validate headers

    delete headers[parameter.name];
  }

  for (const key in headers) {
    results.push({
      code: "request.header.unknown",
      message: `Request header is not defined in the spec file: ${key}`,
      mockDetails: {
        interactionDescription: interaction.description,
        interactionState:
          interaction.providerState || interaction.provider_state || "[none]",
        location: `[root].interactions[${index}].request.headers.${key}`,
        mockFile: "pact.json",
        value: String(headers[key]),
      },
      source: "spec-mock-validation",
      specDetails: {
        location: `[root].paths.${path}.${method}`,
        pathMethod: method,
        pathName: path,
        specFile: "oas.yaml",
        value: operation,
      },
      type: "warning",
    });
  }

  return results;
}
