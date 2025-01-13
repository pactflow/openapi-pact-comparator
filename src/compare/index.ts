import type { OpenAPIV3 } from "openapi-types";
import qs from "qs";
import type { Pact } from "../documents/pact";
import type { Result } from "../results";
import type { HTTPMethod } from "find-my-way";

import debug from "debug";
import SwaggerParser from "@apidevtools/swagger-parser";
import { cloneDeep } from "lodash-es";
import { setupAjv, setupRouter } from "./setup";
import { parse } from "../documents/pact";
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
  // TODO: validate pact
  await SwaggerParser.validate(cloneDeep(oas));
  const parsedPact = parse(pact);

  debugSetup("start");
  const ajv = setupAjv();
  debugSetup("end ajv");
  const router = setupRouter(oas);
  debugSetup("end router");

  debugComparison("start");

  if (parsedPact.interactions.length === 0) {
    yield {
      code: "pact-broker.no-pacts-found",
      message: "No consumer pacts found in Pact Broker",
      type: "warning",
    };
  }

  for (const [index, interaction] of parsedPact.interactions.entries()) {
    debugInteraction("start");
    const { method, path, query } = interaction.request;
    // in pact, query is either a string or an object of only one level deep
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
          value: undefined,
        },
        type: "error",
      };
      debugInteraction("end");
      continue;
    }

    yield* compareReqPath(ajv, route, interaction, index);
    yield* compareReqHeader(ajv, route, interaction, index);
    yield* compareReqQuery(ajv, route, interaction, index);
    yield* compareReqBody(ajv, route, interaction, index);
    yield* compareResHeader(ajv, route, interaction, index);
    yield* compareResBody(ajv, route, interaction, index);

    debugInteraction("end");
  }
  debugComparison("end");
}
