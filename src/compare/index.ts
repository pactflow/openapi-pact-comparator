import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { HTTPMethod } from "find-my-way";
import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import { compareAsyncInteraction } from "#compare/asyncapi/index";
import { compareReqBody } from "#compare/requestBody";
import { compareReqHeader } from "#compare/requestHeader";
import { compareReqPath } from "#compare/requestPath";
import { compareReqQuery } from "#compare/requestQuery";
import { compareReqSecurity } from "#compare/requestSecurity";
import { compareResBody } from "#compare/responseBody";
import { compareResHeader } from "#compare/responseHeader";
import type { AsyncAPIDocument, Message } from "#documents/asyncapi";
import { parse as parseAsyncapi } from "#documents/asyncapi";
import { parse as parseOas } from "#documents/oas";
import type { AsyncInteraction, HttpInteraction, Pact } from "#documents/pact";
import { parse as parsePact } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import { type Config, type ConfigKeys, DEFAULT_CONFIG } from "#utils/config";
import { ARRAY_SEPARATOR } from "#utils/queryParams";
import { setupAjv, setupRouter } from "./setup";

export interface ComparatorOptions {
  oas?: OpenAPIV2.Document | OpenAPIV3.Document;
  asyncapi?: AsyncAPIDocument;
}

export class Comparator {
  #ajvCoerce: Ajv;
  #ajvNocoerce: Ajv;
  #config: Config;
  #oas?: OpenAPIV2.Document | OpenAPIV3.Document;
  #asyncapi?: AsyncAPIDocument;
  #router?: Router.Instance<Router.HTTPVersion.V1>;
  #resolvedMessages: Map<string, Message | null> = new Map();

  constructor(options: ComparatorOptions = {}) {
    this.#config = new Map(DEFAULT_CONFIG);
    this.#oas = options.oas;
    this.#asyncapi = options.asyncapi;
    if (options.oas) parseOas(options.oas);
    if (options.asyncapi) parseAsyncapi(options.asyncapi);

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
    this.#resolvedMessages = new Map();

    if (this.#oas && !this.#router) {
      for (const [key, value] of Object.entries(this.#oas.info)) {
        if (key.startsWith("x-opc-config-")) {
          this.#config.set(key.substring(13) as ConfigKeys, value);
        }
      }
      this.#router = setupRouter(this.#oas, this.#config);
    }

    const parsedPact = parsePact(pact);

    for (const [index, interaction] of parsedPact.interactions.entries()) {
      if (interaction._kind === "skip") {
        continue;
      }

      if (interaction._kind === "async") {
        yield* compareAsyncInteraction(
          this.#ajvNocoerce,
          this.#asyncapi,
          this.#resolvedMessages,
          interaction as AsyncInteraction,
          index,
        );
        continue;
      }

      // HTTP interaction — require OAS
      if (!this.#oas) {
        yield {
          code: "request.spec.missing",
          message: "No OpenAPI document provided to validate HTTP interaction",
          mockDetails: {
            ...baseMockDetails(interaction as HttpInteraction),
            location: `[root].interactions[${index}]`,
            value: (interaction as HttpInteraction).description,
          },
          specDetails: { location: "[root]", value: undefined },
          type: "error",
        };
        continue;
      }

      const httpInteraction = interaction as HttpInteraction;
      const { method, path, query } = httpInteraction.request;
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
      const route = this.#router!.find(
        method.toUpperCase() as HTTPMethod,
        [pathWithLeadingSlash, stringQuery].filter(Boolean).join("?"),
      );

      if (!route || pathWithLeadingSlash.includes("?")) {
        yield {
          code: "request.path-or-method.unknown",
          message: `Path or method not defined in spec file: ${method} ${path}`,
          mockDetails: {
            ...baseMockDetails(httpInteraction),
            location: `[root].interactions[${index}].request.path`,
            value: httpInteraction.request.path,
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
          httpInteraction,
          index,
          this.#config,
        ),
      );

      if (results.length) {
        yield* results;
        continue;
      }

      yield* compareReqSecurity(
        this.#ajvCoerce,
        route,
        httpInteraction,
        index,
        this.#config,
      );
      yield* compareReqHeader(
        this.#ajvCoerce,
        route,
        httpInteraction,
        index,
        this.#config,
      );
      yield* compareReqQuery(
        this.#ajvCoerce,
        route,
        httpInteraction,
        index,
        this.#config,
      );
      yield* compareReqBody(
        this.#ajvNocoerce,
        route,
        httpInteraction,
        index,
        this.#config,
      );
      yield* compareResHeader(
        this.#ajvCoerce,
        route,
        httpInteraction,
        index,
        this.#config,
      );
      yield* compareResBody(
        this.#ajvNocoerce,
        route,
        httpInteraction,
        index,
        this.#config,
      );
    }
  }
}
