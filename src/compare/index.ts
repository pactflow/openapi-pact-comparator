import type { OpenAPIV3 } from "openapi-types";
import qs from "qs";
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
  #oas: OpenAPIV3.Document;
  #router: Router.Instance<Router.HTTPVersion.V1>;

  constructor(oas: OpenAPIV3.Document) {
    const ajvOptions = {
      allErrors: true,
      discriminator: true,
      logger: false,
      strictSchema: false,
    };

    this.#ajvCoerce = setupAjv({
      ...ajvOptions,
      coerceTypes: true,
    });
    this.#ajvNocoerce = setupAjv({
      ...ajvOptions,
      coerceTypes: false,
    });
    this.#oas = oas;
    this.#router = setupRouter(oas);
  }

  async validate() {
    return SwaggerParser.validate(cloneDeep(this.#oas));
  }

  async *compare(pact: Pact): AsyncGenerator<Partial<Result>> {
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
        typeof query === "string" ? query : qs.stringify(query);
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
