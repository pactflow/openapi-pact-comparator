import type { OpenAPIV3 } from "openapi-types";
import qs from "qs";
import type { Pact } from "../documents/pact";
import type { Result } from "../results";
import type { HTTPMethod } from "find-my-way";

import debug from "debug";
import { setupAjv, setupRouter } from "./setup";
import { compareReqPath } from "./requestPath";
import { compareReqQuery } from "./requestQuery";
import { compareReqBody } from "./requestBody";
import { compareReqHeader } from "./requestHeader";
import { compareResBody } from "./responseBody";
import { compareResHeader } from "./responseHeader";
import { baseMockDetails } from "../results";

const debugSetup = debug("setup");
const debugComparison = debug("comparison");
const debugInteraction = debug("interaction");

export async function* compare(
  oas: OpenAPIV3.Document,
  pact: Pact,
): AsyncIterable<Partial<Result>> {
  // TODO: validate oas and pact
  debugSetup("start");
  const ajv = setupAjv();
  debugSetup("end ajv");
  const router = setupRouter(oas);
  debugSetup("end router");

  debugComparison("start");
  for (const [index, interaction] of pact.interactions.entries()) {
    debugInteraction("start");
    const { method, path, query } = interaction.request;
    const stringQuery = typeof query === "string" ? query : qs.stringify(query);
    const route = router.find(
      method as HTTPMethod,
      [path, stringQuery].filter(Boolean).join("?"),
    );

    if (!route) {
      yield {
        code: "request.path-or-method.unknown",
        message: `Path or method not defined in spec file: ${method} ${path}`,
        mockDetails: {
          ...baseMockDetails(interaction),
          location: `[root].interactions[${index}].request.path`,
          value: interaction.request.path,
        },
        specDetails: {
          location: "[root].paths",
          pathMethod: null,
          pathName: null,
          value: oas.paths, // FIXME: this can be big! do we really want to replicate nearly all of the oas?
        },
        type: "error",
      };
      debugInteraction("end");
      continue;
    }

    yield* compareReqPath(ajv, route);
    yield* compareReqHeader(ajv, route, interaction, index);
    yield* compareReqQuery(ajv, route, interaction, index);
    yield* compareReqBody(ajv, route, interaction, index);
    yield* compareResHeader(ajv, route, interaction, index);
    yield* compareResBody(ajv, route, interaction, index);

    debugInteraction("end");
  }
  debugComparison("end");
}
