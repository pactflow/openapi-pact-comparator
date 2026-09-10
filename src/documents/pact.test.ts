import { describe, expect, it } from "vitest";
import { type Pact, type SyncInteraction, parse } from "./pact";

describe("#parser", () => {
  it("flattens headers", () => {
    const json = {
      interactions: [
        {
          request: {
            method: "POST",
            path: "/stuff",
            headers: {
              Accept: ["text/plain", "application/json", "text/json"],
              "Content-Type": ["text/json"],
            },
          },
          response: {
            status: 201,
            headers: {
              "Content-Type": ["application/json"],
            },
            body: "body",
          },
        },
      ],
    } as Pact;

    const parsed = parse(json).interactions[0];
    if (parsed._kind !== "http") throw new Error("expected http interaction");
    expect(parsed.request.headers!["Content-Type"]).toEqual("text/json");
    expect(parsed.request.headers!["Accept"]).toEqual(
      "text/plain,application/json,text/json",
    );
    expect(parsed.response.headers!["Content-Type"]).toEqual(
      "application/json",
    );
  });

  it("maps interactions to _kind discriminants", () => {
    const request = { method: "GET", path: "/path" };
    const response = { status: 200 };
    const json = {
      interactions: [
        { description: "no-type", request, response },
        { type: "Synchronous/HTTP", description: "http", request, response },
        { type: "Asynchronous/Messages", description: "async-message" },
        {
          type: "Synchronous/Messages",
          description: "sync-message",
          request: {
            contents: {
              content: {},
              contentType: "application/json",
              encoded: false,
            },
          },
          response: [
            {
              contents: {
                content: {},
                contentType: "application/json",
                encoded: false,
              },
            },
          ],
        },
      ],
    };

    const pact = parse(json as Pact);
    expect(pact.interactions.length).toBe(4);
    expect(pact.interactions[0]._kind).toBe("http");
    expect(pact.interactions[1]._kind).toBe("http");
    expect(pact.interactions[2]._kind).toBe("async");
    expect(pact.interactions[3]._kind).toBe("sync");
  });

  it("parses asyncapiReferences when present in comments", () => {
    const json = {
      interactions: [
        {
          type: "Asynchronous/Messages",
          description: "org-deleted",
          providerState: "an org exists",
          comments: {
            references: {
              AsyncAPI: {
                operationId: "consumeFromEventsQueue",
              },
            },
          },
          contents: {
            content: { organizationId: "abc-123" },
            contentType: "application/json",
            encoded: false,
          },
          metadata: { "detail-type": "organization-deleted" },
        },
      ],
    };

    const pact = parse(json as Pact);
    const interaction = pact.interactions[0];
    if (interaction._kind !== "async")
      throw new Error("expected async interaction");
    expect(interaction.asyncapiReferences).toEqual({
      operationId: "consumeFromEventsQueue",
    });
    expect(interaction.payload).toEqual({ organizationId: "abc-123" });
    expect(interaction.contentType).toBe("application/json");
    expect(interaction.metadata).toEqual({
      "detail-type": "organization-deleted",
    });
    expect(interaction.description).toBe("org-deleted");
    expect(interaction.providerState).toBe("an org exists");
  });

  it("does not crash and skips interactions with non-string type values", () => {
    const request = { method: "GET", path: "/path" };
    const response = { status: 200 };
    const json = {
      interactions: [
        { type: 123, description: "numeric-type", request, response },
        { type: true, description: "bool-type", request, response },
        { type: {}, description: "object-type", request, response },
      ],
    };

    expect(() => parse(json as Pact)).not.toThrow();
    const pact = parse(json as Pact);
    expect(pact.interactions).toHaveLength(3);
    pact.interactions.forEach((i) => expect(i._kind).toBe("skip"));
  });

  it("leaves asyncapiReferences undefined when comments.references.AsyncAPI is absent", () => {
    const json = {
      interactions: [
        {
          type: "Asynchronous/Messages",
          contents: {
            content: { foo: "bar" },
            contentType: "application/json",
            encoded: false,
          },
        },
        {
          type: "Asynchronous/Messages",
          comments: { references: {} },
          contents: {
            content: "plain",
            contentType: "text/plain",
            encoded: false,
          },
        },
      ],
    };

    const pact = parse(json as Pact);
    const first = pact.interactions[0];
    const second = pact.interactions[1];
    if (first._kind !== "async" || second._kind !== "async")
      throw new Error("expected async interactions");
    expect(first.asyncapiReferences).toBeUndefined();
    expect(second.asyncapiReferences).toBeUndefined();
  });

  it("should parse V4 body types", () => {
    const withRequestBody = (body: unknown) => ({
      request: {
        method: "POST",
        path: "/products",
        body,
      },
      response: {
        status: 200,
      },
    });
    const withResponseBody = (body: unknown) => ({
      request: {
        method: "POST",
        path: "/products",
      },
      response: {
        status: 200,
        body,
      },
    });

    const json = {
      interactions: [
        withResponseBody({
          encoded: false,
          content: { hello: "world" },
        }),
        withResponseBody({
          encoded: "JSON",
          content: '{ "hello": "world" }',
        }),
        withResponseBody({
          encoded: "base64",
          content: "aGVsbG8gd29ybGQ=",
        }),
        withRequestBody({
          encoded: false,
          content: { hello: "world" },
        }),
        withRequestBody({
          encoded: "JSON",
          content: '{ "hello": "world" }',
        }),
        withRequestBody({
          encoded: "base64",
          content: "aGVsbG8gd29ybGQ=",
        }),
        withRequestBody({
          encoded: "JSON",
          content: "{ not: json }",
        }),
        withRequestBody({
          encoded: "foo",
          content: "abcdef",
        }),
      ],
      metadata: {
        pactSpecification: {
          version: "4.0.0",
        },
      },
    };

    const pact = parse(json as Pact);

    const interactions = pact.interactions.map((i) => {
      if (i._kind !== "http") throw new Error("expected http interaction");
      return i;
    });

    expect(interactions[0].response.body).toEqual({ hello: "world" });
    expect(interactions[1].response.body).toEqual({ hello: "world" });
    expect(interactions[2].response.body).toEqual("hello world");
    expect(interactions[3].request.body).toEqual({ hello: "world" });
    expect(interactions[4].request.body).toEqual({ hello: "world" });
    expect(interactions[5].request.body).toEqual("hello world");
    expect(interactions[6].request.body).toEqual("{ not: json }");
    expect(interactions[7].request.body).toEqual("abcdef");
  });
});

describe("parse — Synchronous/Messages", () => {
  const syncPact = {
    interactions: [
      {
        type: "Synchronous/Messages",
        description: "place an order",
        providerState: "the service is up",
        comments: {
          references: {
            AsyncAPI: {
              operationId: "sendOrder",
            },
          },
        },
        request: {
          contents: {
            content: { orderId: "o-123" },
            contentType: "application/json",
            encoded: false,
          },
          metadata: { "reply-to": "replies.queue" },
        },
        response: [
          {
            contents: {
              content: { status: "accepted" },
              contentType: "application/json",
              encoded: false,
            },
            metadata: { "correlation-id": "c-abc" },
          },
        ],
      },
    ],
    metadata: { pactSpecification: { version: "4.0" } },
  };

  it("parses Synchronous/Messages to _kind: sync", () => {
    const pact = parse(syncPact as Pact);
    expect(pact.interactions).toHaveLength(1);
    const interaction = pact.interactions[0];
    expect(interaction._kind).toBe("sync");
  });

  it("parses request payload and metadata", () => {
    const pact = parse(syncPact as Pact);
    const interaction = pact.interactions[0] as SyncInteraction;
    expect(interaction.request.payload).toEqual({ orderId: "o-123" });
    expect(interaction.request.contentType).toBe("application/json");
    expect(interaction.request.metadata).toEqual({
      "reply-to": "replies.queue",
    });
  });

  it("parses response array", () => {
    const pact = parse(syncPact as Pact);
    const interaction = pact.interactions[0] as SyncInteraction;
    expect(interaction.responses).toHaveLength(1);
    expect(interaction.responses[0].payload).toEqual({ status: "accepted" });
    expect(interaction.responses[0].metadata).toEqual({
      "correlation-id": "c-abc",
    });
  });

  it("parses asyncapiReferences from comments", () => {
    const pact = parse(syncPact as Pact);
    const interaction = pact.interactions[0] as SyncInteraction;
    expect(interaction.asyncapiReferences).toEqual({
      operationId: "sendOrder",
    });
  });

  it("parses asyncapiReferences as operationId only", () => {
    const replyFieldPact = {
      interactions: [
        {
          type: "Synchronous/Messages",
          comments: {
            references: {
              AsyncAPI: {
                operationId: "sendOrder",
              },
            },
          },
          request: {
            contents: {
              content: {},
              contentType: "application/json",
              encoded: false,
            },
          },
          response: [
            {
              contents: {
                content: {},
                contentType: "application/json",
                encoded: false,
              },
            },
          ],
        },
      ],
      metadata: { pactSpecification: { version: "4.0" } },
    };
    const pact = parse(replyFieldPact as Pact);
    const interaction = pact.interactions[0] as SyncInteraction;
    expect(interaction.asyncapiReferences).toEqual({
      operationId: "sendOrder",
    });
  });

  it("throws when Synchronous/Messages is missing request field", () => {
    const barePact = {
      interactions: [
        { type: "Synchronous/Messages", description: "should fail" },
      ],
      metadata: { pactSpecification: { version: "4.0" } },
    };
    expect(() => parse(barePact as Pact)).toThrow();
  });
});

const v4 = (interaction: unknown) => ({
  metadata: { pactSpecification: { version: "4.0" } },
  interactions: [interaction],
});

const GRAPHQL_QUERY = "query GetProduct($id: ID!) { product(id: $id) { id } }";

describe("graphql classification", () => {
  it("classifies an interaction carrying plugin configuration", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        description: "a GraphQL product request",
        pluginConfiguration: {
          graphql: {
            query_document: GRAPHQL_QUERY,
            operation_name: "GetProduct",
            variables_json: '{"id":"10"}',
            inline_schema: {
              base64_sdl: Buffer.from("type Query { a: String }").toString(
                "base64",
              ),
            },
            schema_ref: { hash: "abc123" },
          },
        },
        request: {
          method: "POST",
          path: "/graphql",
          body: {
            contentType: "application/graphql",
            encoded: false,
            content: {
              query: GRAPHQL_QUERY,
              variables: { id: "10" },
              operationName: "GetProduct",
            },
          },
        },
        response: {
          status: 200,
          body: {
            encoded: false,
            content: { data: { product: { id: "10" } } },
          },
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    const i = interactions[0];
    expect(i._kind).toBe("graphql-http");
    expect(i.operation.source).toBe("plugin");
    expect(i.operation.document).toBe(GRAPHQL_QUERY);
    expect(i.operation.operationName).toBe("GetProduct");
    expect(i.operation.variables).toEqual({ id: "10" });
    expect(i.operation.inconsistent).toBe(false);
    expect(i.plugin.schemaHash).toBe("abc123");
    expect(i.plugin.inlineSchemaSdl).toBe("type Query { a: String }");
  });

  it("classifies a plain POST whose body is a graphql envelope", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: {
          method: "POST",
          path: "/graphql",
          body: {
            encoded: false,
            content: { query: GRAPHQL_QUERY, variables: { id: "10" } },
          },
        },
        response: {
          status: 200,
          body: { encoded: false, content: { data: {} } },
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    expect(interactions[0]._kind).toBe("graphql-http");
    expect(interactions[0].operation.source).toBe("body");
  });

  it("does not misclassify a REST endpoint that takes a query string field", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: {
          method: "POST",
          path: "/search",
          body: {
            encoded: false,
            content: { query: "SELECT * FROM products" },
          },
        },
        response: { status: 200, body: { encoded: false, content: {} } },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    expect(interactions[0]._kind).toBe("http");
  });

  it("does not misclassify a body carrying extra non-graphql keys", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: {
          method: "POST",
          path: "/search",
          body: {
            encoded: false,
            content: { query: GRAPHQL_QUERY, tenantId: "acme" },
          },
        },
        response: { status: 200, body: { encoded: false, content: {} } },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    expect(interactions[0]._kind).toBe("http");
  });

  it("does not classify a GET as graphql", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: { method: "GET", path: "/graphql" },
        response: { status: 200, body: { encoded: false, content: {} } },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    expect(interactions[0]._kind).toBe("http");
  });

  it("flags disagreement between plugin config and request body (4.1)", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        pluginConfiguration: {
          graphql: {
            query_document: GRAPHQL_QUERY,
            variables_json: '{"id":"10"}',
          },
        },
        request: {
          method: "POST",
          path: "/graphql",
          body: {
            encoded: false,
            content: { query: "{ somethingElse }", variables: { id: "99" } },
          },
        },
        response: {
          status: 200,
          body: { encoded: false, content: { data: {} } },
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    expect(interactions[0].operation.inconsistent).toBe(true);
    expect(interactions[0].operation.document).toBe(GRAPHQL_QUERY);
  });

  it("leaves REST interactions untouched", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: { method: "GET", path: "/products" },
        response: { status: 200, body: { encoded: false, content: [] } },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    expect(interactions[0]._kind).toBe("http");
  });
});

const SUBSCRIPTION =
  "subscription InventoryChanged($variantId: ID!) { inventoryChanged(variantId: $variantId) { quantity } }";

describe("graphql message classification", () => {
  it("classifies an async message carrying graphql plugin config", () => {
    const { interactions } = parse({
      metadata: { pactSpecification: { version: "4.0" } },
      interactions: [
        {
          type: "Asynchronous/Messages",
          description: "an inventory change message",
          pluginConfiguration: {
            graphql: {
              query_document: SUBSCRIPTION,
              operation_name: "InventoryChanged",
              variables_json: '{"variantId":"var-1"}',
            },
          },
          contents: {
            encoded: false,
            content: {
              subscription: "InventoryChanged",
              variables: { variantId: "var-1" },
              data: { inventoryChanged: { quantity: 42 } },
            },
          },
        },
      ],
    } as Pact) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interactions: any[];
    };

    const i = interactions[0];
    expect(i._kind).toBe("graphql-message");
    expect(i.operation.document).toBe(SUBSCRIPTION);
    expect(i.payload).toEqual({ data: { inventoryChanged: { quantity: 42 } } });
  });

  it("leaves a plain async message alone", () => {
    const { interactions } = parse({
      metadata: { pactSpecification: { version: "4.0" } },
      interactions: [
        {
          type: "Asynchronous/Messages",
          contents: { encoded: false, content: { a: 1 } },
        },
      ],
    } as Pact);
    expect(interactions[0]._kind).toBe("async");
  });
});
