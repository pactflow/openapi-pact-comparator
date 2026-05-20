import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { HTTPMethod } from "find-my-way";

import type { HttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import type { Config } from "#utils/config";
import { ARRAY_SEPARATOR } from "#utils/queryParams";

import { compareReqBody } from "./requestBody";
import { compareReqHeader } from "./requestHeader";
import { compareReqPath } from "./requestPath";
import { compareReqQuery } from "./requestQuery";
import { compareReqSecurity } from "./requestSecurity";
import { compareResBody } from "./responseBody";
import { compareResHeader } from "./responseHeader";

export function* compareHttpInteraction(
  ajvCoerce: Ajv,
  ajvNocoerce: Ajv,
  router: Router.Instance<Router.HTTPVersion.V1> | undefined,
  interaction: HttpInteraction,
  index: number,
  config: Config,
): Iterable<Result> {
  if (!router) {
    yield {
      code: "request.spec.missing",
      message: "No OpenAPI document provided to validate HTTP interaction",
      mockDetails: {
        ...baseMockDetails(interaction),
        location: `[root].interactions[${index}]`,
        value: interaction.description,
      },
      specDetails: { location: "[root]", value: undefined },
      type: "error",
    };
    return;
  }

  const { method, path, query } = interaction.request;
  let pathWithLeadingSlash = path.startsWith("/") ? path : `/${path}`;

  if (config.get("no-percent-encoding")) {
    pathWithLeadingSlash = pathWithLeadingSlash.replaceAll("%", "%25");
  }

  // in pact, query is either a string or an object of only one level deep
  const stringQuery =
    typeof query === "string"
      ? query
      : Object.keys(query || {})
          .reduce(
            (acc, name) =>
              Array.isArray(query![name])
                ? `${acc}&${name}=${(query![name] || []).join(ARRAY_SEPARATOR)}`
                : `${acc}&${name}=${query![name] || ""}`,
            "",
          )
          .substring(1);

  const route = router.find(
    method.toUpperCase() as HTTPMethod,
    [pathWithLeadingSlash, stringQuery].filter(Boolean).join("?"),
  );

  if (!route || pathWithLeadingSlash.includes("?")) {
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
    return;
  }

  const results = Array.from(
    compareReqPath(ajvCoerce, route, interaction, index, config),
  );

  if (results.length) {
    yield* results;
    return;
  }

  yield* compareReqSecurity(ajvCoerce, route, interaction, index, config);
  yield* compareReqHeader(ajvCoerce, route, interaction, index, config);
  yield* compareReqQuery(ajvCoerce, route, interaction, index, config);
  yield* compareReqBody(ajvNocoerce, route, interaction, index, config);
  yield* compareResHeader(ajvCoerce, route, interaction, index, config);
  yield* compareResBody(ajvNocoerce, route, interaction, index, config);
}
