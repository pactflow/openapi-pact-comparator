import type { OpenAPIV3 } from "openapi-types";
import debug from "debug";
import { dereferenceSchema } from "../transform";
import { setupAjv, setupRouter } from "./setup";
import { comparePathParameters } from "./pathParameters";
import { compareQueryParameters } from "./queryParameters";
import { compareReqBody } from "./requestBody";
import { compareResBody } from "./responseBody";

const debugSetup = debug("setup");
const debugComparison = debug("comparison");
const debugInteraction = debug("interaction");

export async function* compare(oas: OpenAPIV3.Document, pact) {
  debugSetup("start");
  const ajv = setupAjv();
  debugSetup("end ajv");
  const flatOas = await dereferenceSchema(oas) as OpenAPIV3.Document;
  debugSetup("end dereference");
  const router = setupRouter(flatOas);
  debugSetup("end router");

  debugComparison("start")
  for (const interaction of pact.interactions) {
    debugInteraction("start");
    const route = router.find(
      interaction.request.method,
      `${interaction.request.path}?${interaction.request.query}`,
    );

    if (!route) {
      yield [interaction, [], []];
      debugInteraction("end");
      continue;
    }

    const pathComparison = comparePathParameters(ajv, route);
    const queryComparison = compareQueryParameters(ajv, route);
    // TODO: headerComparison
    // TODO: cookieComparison
    const reqBodyComparison = compareReqBody(ajv, route, interaction);
    const resBodyComparison = compareResBody(ajv, route, interaction);

    yield [
      interaction,
      [
        ...pathComparison.errors,
        ...queryComparison.errors,
        ...reqBodyComparison.errors,
        ...resBodyComparison.errors,
      ],
      [
        ...pathComparison.warnings,
        ...queryComparison.warnings,
        ...reqBodyComparison.warnings,
        ...resBodyComparison.warnings,
      ],
    ];
    debugInteraction("end");
  }
  debugComparison("end")
}
