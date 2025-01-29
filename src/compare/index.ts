import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import Ajv from "ajv/dist/2019";
import Router, { HTTPMethod } from "find-my-way";
import SwaggerParser from "@apidevtools/swagger-parser";
import { cloneDeep } from "lodash-es";

import type { Pact } from "../documents/pact";
import type { Result } from "../results";
import { setupAjv, setupRouter } from "./setup";
import { parse } from "../documents/pact";
import { compareReqPath } from "./requestPath";
import { compareReqQuery } from "./requestQuery";
import { compareReqBody } from "./requestBody";
import { compareReqHeader } from "./requestHeader";
import { compareResBody } from "./responseBody";
import { compareResHeader } from "./responseHeader";
import { baseMockDetails } from "../results";

export class Comparator {
  #ajvCoerce: Ajv;
  #ajvNocoerce: Ajv;
  #oas: OpenAPIV2.Document | OpenAPIV3.Document;
  #router: Router.Instance<Router.HTTPVersion.V1>;

  constructor(oas: OpenAPIV2.Document | OpenAPIV3.Document) {
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
    this.#oas = oas;
    this.#router = setupRouter(oas);
  }

  async validate() {
    if (this.isOpenApi3 || this.isSwagger2) {
      return SwaggerParser.validate(cloneDeep(this.#oas));
    }

    const e = new Error("Malformed input");
    e.name = "ParseError";
    throw e;
  }

  get isOpenApi3(): boolean {
    return (
      Object.prototype.hasOwnProperty.call(this.#oas, "openapi") &&
      typeof (this.#oas as OpenAPIV3.Document).openapi === "string" &&
      (this.#oas as OpenAPIV3.Document).openapi.indexOf("3.") === 0
    );
  }

  get isSwagger2() {
    return (
      Object.prototype.hasOwnProperty.call(this.#oas, "swagger") &&
      typeof (this.#oas as OpenAPIV2.Document).swagger === "string" &&
      (this.#oas as OpenAPIV2.Document).swagger === "2.0"
    );
  }

  async *compare(pact: Pact): AsyncGenerator<Result> {
    const parsedPact = parse(pact);

    if (parsedPact.interactions.length === 0) {
      yield {
        code: "pact-broker.no-pacts-found",
        message: "No consumer pacts found in Pact Broker",
        type: "warning",
      };
    }

    for (const [index, interaction] of parsedPact.interactions.entries()) {
      const { method, path, query } = interaction.request;
      // in pact, query is either a string or an object of only one level deep
      const stringQuery =
        typeof query === "string"
          ? query
          : Object.keys(query || {}).reduce(
              (acc, name) =>
                Array.isArray(query![name])
                  ? `${acc}&${name}=${(query![name] || []).join(",")}`
                  : `${acc}&${name}=${query![name] || ""}`,
              "",
            );
      const route = this.#router.find(
        method.toUpperCase() as HTTPMethod,
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
        continue;
      }

      yield* compareReqPath(this.#ajvCoerce, route, interaction, index);
      yield* compareReqHeader(this.#ajvCoerce, route, interaction, index);
      yield* compareReqQuery(this.#ajvCoerce, route, interaction, index);
      yield* compareReqBody(this.#ajvNocoerce, route, interaction, index);
      yield* compareResHeader(this.#ajvCoerce, route, interaction, index);
      yield* compareResBody(this.#ajvNocoerce, route, interaction, index);
    }
  }
}
