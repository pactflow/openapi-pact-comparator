import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import Ajv from "ajv/dist/2019";
import Router, { HTTPMethod } from "find-my-way";

import type { Pact } from "#documents/pact";
import type { Result } from "#results/index";

import { compareReqPath } from "#compare/requestPath";
import { compareReqQuery } from "#compare/requestQuery";
import { compareReqBody } from "#compare/requestBody";
import { compareReqHeader } from "#compare/requestHeader";
import { compareReqSecurity } from "#compare/requestSecurity";
import { compareResBody } from "#compare/responseBody";
import { compareResHeader } from "#compare/responseHeader";
import { parse as parseOas } from "#documents/oas";
import { parse as parsePact } from "#documents/pact";
import { baseMockDetails } from "#results/index";
import { Config, ConfigKeys, DEFAULT_CONFIG } from "#utils/config";
import { ARRAY_SEPARATOR } from "#utils/queryParams";

import { setupAjv, setupRouter } from "./setup";

export class Comparator {
  #ajvCoerce: Ajv;
  #ajvNocoerce: Ajv;
  #config: Config;
  #oas: OpenAPIV2.Document | OpenAPIV3.Document;
  #router?: Router.Instance<Router.HTTPVersion.V1>;

  constructor(oas: OpenAPIV2.Document | OpenAPIV3.Document) {
    this.#config = new Map(DEFAULT_CONFIG);
    this.#oas = oas;

    parseOas(oas);

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
      for (const [key, value] of Object.entries(this.#oas.info)) {
        if (key.startsWith("x-opc-config-")) {
          this.#config.set(key.substring(13) as ConfigKeys, value);
        }
      }
      this.#router = setupRouter(this.#oas, this.#config);
    }

    const parsedPact = parsePact(pact);

    const parsedInteractions = parsedPact.interactions || [];

    for (const [index, interaction] of parsedInteractions.entries()) {
      if (interaction._nonHTTP) {
        yield {
          code: "interaction.type.unsupported",
          mockDetails: {
            ...baseMockDetails(interaction),
            location: `[root].interactions[${index}].type`,
            value: interaction.type,
          },
          message: `Non-HTTP messages cannot be verified against an HTTP-only OpenAPI Document.`,
          type: "warning",
        };
        continue;
      }

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

      yield* compareReqSecurity(
        this.#ajvCoerce,
        route,
        interaction,
        index,
        this.#config,
      );
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

    if (parsedPact.messages) {
      for (const [index, message] of parsedPact.messages.entries()) {
        yield {
          code: "interaction.type.unsupported",
          mockDetails: {
            interactionDescription: message.description,
            interactionState: message.providerState || "[none]",
            location: `[root].messages[${index}]`,
            value: message,
          },
          message: `Non-HTTP messages cannot be verified against an HTTP-only OpenAPI Document.`,
          type: "warning",
        };
      }
    }
  }
}
