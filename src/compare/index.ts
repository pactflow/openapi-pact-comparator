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
  for (const interaction of pact.interactions) {
    debugInteraction("start");
    const route = router.find(
      interaction.request.method,
      `${interaction.request.path}?${interaction.request.query}`,
    );

    if (!route) {
      yield [];
      debugInteraction("end");
      continue;
    }

    const pathResults = comparePathParameters(ajv, route);
    const queryResults = compareQueryParameters(ajv, route);
    // TODO: headerComparison
    // TODO: cookieComparison
    const reqBodyResults = compareReqBody(ajv, route, interaction);
    const resBodyResults = compareResBody(ajv, route, interaction);

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
