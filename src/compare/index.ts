import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import { compareAsyncInteraction } from "#compare/asyncapi/index";
import { compareHttpInteraction } from "#compare/oas/index";
import type { AsyncAPIDocument, Message } from "#documents/asyncapi";
import { parse as parseAsyncapi } from "#documents/asyncapi";
import { parse as parseOas } from "#documents/oas";
import type { AsyncInteraction, HttpInteraction, Pact } from "#documents/pact";
import { parse as parsePact } from "#documents/pact";
import type { Result } from "#results/index";
import { type Config, type ConfigKeys, DEFAULT_CONFIG } from "#utils/config";
import { setupRouter } from "./oas/setup";
import { setupAjv } from "./setup";

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

      yield* compareHttpInteraction(
        this.#ajvCoerce,
        this.#ajvNocoerce,
        this.#router,
        interaction as HttpInteraction,
        index,
        this.#config,
      );
    }
  }
}
