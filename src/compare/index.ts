import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import type { GraphQLSchema } from "graphql";
import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import { compareAsyncInteraction } from "#compare/asyncapi/index";
import { compareSyncInteraction } from "#compare/asyncapi/syncMessage";
import { compareGraphqlHttpInteraction } from "#compare/graphql/index";
import type { ProvenanceState } from "#compare/graphql/schemaProvenance";
import { compareGraphqlMessageInteraction } from "#compare/graphql/subscriptionMessage";
import { compareHttpInteraction } from "#compare/oas/index";
import type { AsyncAPIDocument, ResolvedMessage } from "#documents/asyncapi";
import { parse as parseAsyncapi } from "#documents/asyncapi";
import { parse as parseGraphqlSchema } from "#documents/graphql";
import { parse as parseOas } from "#documents/oas";
import type { Pact } from "#documents/pact";
import { parse as parsePact } from "#documents/pact";
import type { Result } from "#results/index";
import { type Config, type ConfigKeys, DEFAULT_CONFIG } from "#utils/config";
import { setupRouter } from "./oas/setup";
import { setupAjv } from "./setup";

export interface ComparatorOptions {
  oas?: OpenAPIV2.Document | OpenAPIV3.Document;
  asyncapi?: AsyncAPIDocument;
  /** Provider contract as GraphQL SDL text. */
  graphql?: string;
}

export class Comparator {
  #ajvCoerce: Ajv;
  #ajvNocoerce: Ajv;
  #config: Config;
  #oas?: OpenAPIV2.Document | OpenAPIV3.Document;
  #asyncapi?: AsyncAPIDocument;
  #graphql?: GraphQLSchema;
  #graphqlSdl?: string;
  #router?: Router.Instance<Router.HTTPVersion.V1>;
  #resolvedMessages: Map<string, ResolvedMessage> = new Map();

  constructor(options: ComparatorOptions = {}) {
    this.#config = new Map(DEFAULT_CONFIG);
    this.#oas = options.oas;
    this.#asyncapi = options.asyncapi;
    if (options.oas) parseOas(options.oas);
    if (options.asyncapi) parseAsyncapi(options.asyncapi);
    if (options.graphql) {
      this.#graphql = parseGraphqlSchema(options.graphql);
      this.#graphqlSdl = options.graphql;
    }

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
    const provenance: ProvenanceState = { reported: false };

    for (const [index, interaction] of parsedPact.interactions.entries()) {
      switch (interaction._kind) {
        case "http":
          if (!this.#oas) break;
          yield* compareHttpInteraction(
            this.#ajvCoerce,
            this.#ajvNocoerce,
            this.#router,
            interaction,
            index,
            this.#config,
          );
          break;
        case "graphql-http":
          if (!this.#graphql || !this.#graphqlSdl) break;
          yield* compareGraphqlHttpInteraction(
            this.#ajvNocoerce,
            this.#graphql,
            this.#graphqlSdl,
            provenance,
            interaction,
            index,
          );
          break;
        case "async":
          if (this.#oas && !this.#asyncapi) break;
          yield* compareAsyncInteraction(
            this.#ajvNocoerce,
            this.#asyncapi,
            this.#resolvedMessages,
            interaction,
            index,
          );
          break;
        case "sync":
          if (this.#oas && !this.#asyncapi) break;
          yield* compareSyncInteraction(
            this.#ajvNocoerce,
            this.#asyncapi,
            this.#resolvedMessages,
            interaction,
            index,
          );
          break;
        case "graphql-message":
          if (!this.#graphql) break;
          yield* compareGraphqlMessageInteraction(
            this.#ajvNocoerce,
            this.#graphql,
            interaction,
            index,
          );
          break;
        case "skip":
          break;
        default:
          interaction satisfies never;
      }
    }
  }
}
