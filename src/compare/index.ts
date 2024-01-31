import type { OpenAPIV3 } from "openapi-types";
import debug from "debug";
import type { Result } from "../results";
import { dereferenceSchema } from "../transform";
import { setupAjv, setupRouter } from "./setup";
import { compareReqPath } from "./requestPath";
import { compareReqQuery } from "./requestQuery";
import { compareReqBody } from "./requestBody";
import { compareReqHeader } from "./requestHeader";
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
      [interaction.request.path, interaction.request.query]
        .filter(Boolean)
        .join("?"),
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


    yield [
      ...compareReqPath(ajv, route),
      ...compareReqHeader(ajv, route, interaction, index),
      ...compareReqQuery(ajv, route, interaction, index),
      ...compareReqBody(ajv, route, interaction, index),
      ...compareResBody(ajv, route, interaction, index),
    ];
    debugInteraction("end");
  }
  debugComparison("end");
}
