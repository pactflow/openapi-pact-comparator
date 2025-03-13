import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import Ajv from "ajv/dist/2019";
import Router, { HTTPMethod } from "find-my-way";

import type { Pact } from "../documents/pact";
import type { Result } from "../results/index";
import { setupAjv, setupRouter } from "./setup";
import { parse as parseOas } from "../documents/oas";
import { parse as parsePact } from "../documents/pact";
import { compareReqPath } from "./requestPath";
import { compareReqQuery } from "./requestQuery";
import { compareReqBody } from "./requestBody";
import { compareReqHeader } from "./requestHeader";
import { compareResBody } from "./responseBody";
import { compareResHeader } from "./responseHeader";
import { baseMockDetails } from "../results/index";
import { Config, DEFAULT_CONFIG } from "../utils/config";
import { ARRAY_SEPARATOR } from "../utils/queryParams";

export class Comparator {
  #ajvCoerce: Ajv;
  #ajvNocoerce: Ajv;
  #config: Config;
  #oas: OpenAPIV2.Document | OpenAPIV3.Document;
  #router?: Router.Instance<Router.HTTPVersion.V1>;

  constructor(oas: OpenAPIV2.Document | OpenAPIV3.Document) {
    this.#config = new Map(DEFAULT_CONFIG);
    this.#oas = oas;

    const ajvOptions = {
      allErrors: true,
      discriminator: true,
      strictSchema: false,
    };

    this.#ajvCoerce = setupAjv({
      ...ajvOptions,
      coerceTypes: true,
      logger: false,
    });
    this.#ajvNocoerce = setupAjv({
      ...ajvOptions,
      coerceTypes: false,
      logger: false,
    });
  }

  async *compare(pact: Pact): AsyncGenerator<Result> {
    if (!this.#router) {
      await parseOas(this.#oas);
      this.#router = setupRouter(this.#oas, this.#config);
    }

    const parsedPact = parsePact(pact);

    if (parsedPact.interactions.length === 0) {
      yield {
        code: "pact-broker.no-pacts-found",
        message: "No consumer pacts found in Pact Broker",
        type: "warning",
      };
    }

    for (const [index, interaction] of parsedPact.interactions.entries()) {
      const { method, path, query } = interaction.request;
      let pathWithLeadingSlash = path.startsWith("/") ? path : `/${path}`;

      if (this.#config.get("no-percent-encoding")) {
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
      const route = this.#router.find(
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
        continue;
      }

      const results = Array.from(
        compareReqPath(
          this.#ajvCoerce,
          route,
          interaction,
          index,
          this.#config,
        ),
      );

      if (results.length) {
        yield* results;
        continue;
      }

      yield* compareReqHeader(
        this.#ajvCoerce,
        route,
        interaction,
        index,
        this.#config,
      );
      yield* compareReqQuery(
        this.#ajvCoerce,
        route,
        interaction,
        index,
        this.#config,
      );
      yield* compareReqBody(
        this.#ajvNocoerce,
        route,
        interaction,
        index,
        this.#config,
      );
      yield* compareResHeader(
        this.#ajvCoerce,
        route,
        interaction,
        index,
        this.#config,
      );
      yield* compareResBody(
        this.#ajvNocoerce,
        route,
        interaction,
        index,
        this.#config,
      );
    }
  }
}
