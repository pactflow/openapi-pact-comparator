import type { OpenAPIV3 } from "openapi-types";
import debug from "debug";
import type { Result } from "../results";
import { dereferenceSchema } from "../transform";
import { setupAjv, setupRouter } from "./setup";
import { comparePathParameters } from "./pathParameters";
import { compareQueryParameters } from "./queryParameters";
import { compareReqBody } from "./requestBody";
import { compareResBody } from "./responseBody";

const debugSetup = debug("setup");
const debugComparison = debug("comparison");
const debugInteraction = debug("interaction");

export async function* compare(
  oas: OpenAPIV3.Document,
  pact,
): AsyncIterable<Partial<Result>[]> {
  debugSetup("start");
  const ajv = setupAjv();
  debugSetup("end ajv");
  const flatOas = (await dereferenceSchema(oas)) as OpenAPIV3.Document;
  debugSetup("end dereference");
  const router = setupRouter(flatOas);
  debugSetup("end router");

  debugComparison("start");
  for (const [index, interaction] of pact.interactions.entries()) {
    debugInteraction("start");
    const route = router.find(
      interaction.request.method,
      `${interaction.request.path}?${interaction.request.query}`,
    );

    if (!route) {
      yield [
        {
          code: "request.path-or-method.unknown",
          message: `Path or method not defined in spec file: ${interaction.request.method} ${interaction.request.path}`,
          mockDetails: {
            interactionDescription: interaction.description,
            interactionState:
              interaction.providerState ||
              interaction.provider_state ||
              "[none]",
            location: `[root].interactions[${index}].request.path`,
            mockFile: "pact.json",
            value: interaction.request.path,
          },
          source: "spec-mock-validation",
          specDetails: {
            location: "[root].paths",
            pathMethod: null,
            pathName: null,
            specFile: "oas.yaml",
            value: flatOas.paths,
          },
          type: "error",
        },
      ];
      debugInteraction("end");
      continue;
    }

    const pathResults = comparePathParameters(ajv, route);
    const queryResults = compareQueryParameters(ajv, route);
    // TODO: headerComparison
    // TODO: cookieComparison
    const reqBodyResults = compareReqBody(ajv, route, interaction, index);
    const resBodyResults = compareResBody(ajv, route, interaction, index);

    yield [
      ...pathResults,
      ...queryResults,
      ...reqBodyResults,
      ...resBodyResults,
    ];
    debugInteraction("end");
  }
  debugComparison("end");
}
