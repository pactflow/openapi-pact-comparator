// PactFlow reads the codes and `mockDetails.location` values asserted here to
// decide which pact interactions each provider contract document covers, and so
// whether a pact is deployable (`Pactflow::ProviderContract::DocumentOutcomes`
// in the broker). A change to any of them breaks that classification.
import { describe, expect, it } from "vitest";

import { Comparator } from "../compare";

const oas = {
  openapi: "3.0.0",
  info: { title: "Orders", version: "1.0.0" },
  paths: {
    "/orders": {
      get: { responses: { "200": { description: "ok" } } },
    },
    "/orders/{id}": {
      get: {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
    "/things": {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

const asyncapi = {
  asyncapi: "3.1.0",
  info: { title: "Order Service", version: "1.0.0" },
  channels: {
    requests: {
      messages: {
        OrderRequest: {
          payload: {
            type: "object",
            properties: { orderId: { type: "string" } },
            required: ["orderId"],
          },
        },
      },
    },
    replies: {
      messages: {
        OrderResponse: {
          payload: {
            type: "object",
            properties: { status: { type: "string" } },
            required: ["status"],
          },
        },
      },
    },
  },
  operations: {
    sendOrder: {
      action: "send",
      channel: { $ref: "#/channels/requests" },
      messages: [{ $ref: "#/channels/requests/messages/OrderRequest" }],
      reply: {
        channel: { $ref: "#/channels/replies" },
        messages: [{ $ref: "#/channels/replies/messages/OrderResponse" }],
      },
    },
  },
};

const http = (
  method: string,
  path: string,
  extra: { request?: object } = {},
) => ({
  description: `${method} ${path}`,
  request: { method, path, ...extra.request },
  response: { status: 200 },
});

const message = (operationId: string) => ({
  type: "Asynchronous/Messages",
  description: `message for ${operationId}`,
  comments: { references: { AsyncAPI: { operationId } } },
  contents: {
    content: { orderId: "o-1" },
    contentType: "application/json",
    encoded: false,
  },
});

const pactOf = (...interactions: object[]) => ({
  consumer: { name: "consumer" },
  provider: { name: "provider" },
  interactions,
  metadata: { pactSpecification: { version: "4.0" } },
});

const ALLOW_LIST_CODES = [
  "request.path-or-method.unknown",
  "message.operation.unknown",
  "request.path-parameter.incompatible",
];

const compare = async (
  documents: { oas?: object; asyncapi?: object },
  pact: object,
) => {
  const results = [];
  for await (const result of new Comparator(documents).compare(pact)) {
    results.push(result);
  }
  return results;
};

describe("output PactFlow reads to classify interactions", () => {
  it("reports an absent path as request.path-or-method.unknown", async () => {
    const results = await compare({ oas }, pactOf(http("GET", "/missing")));

    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("request.path-or-method.unknown");
  });

  it("reports an unknown method on a known path as request.path-or-method.unknown", async () => {
    const results = await compare({ oas }, pactOf(http("DELETE", "/orders")));

    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("request.path-or-method.unknown");
  });

  it("reports a wrong-type path parameter as request.path-parameter.incompatible", async () => {
    const results = await compare(
      { oas },
      pactOf(http("GET", "/orders/not-a-number")),
    );

    expect(results.map((r) => r.code)).toContain(
      "request.path-parameter.incompatible",
    );
  });

  it("reports an unknown operationId as message.operation.unknown", async () => {
    const results = await compare(
      { asyncapi },
      pactOf(message("noSuchOperation")),
    );

    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.operation.unknown");
  });

  it("locates each failing interaction by its index in [root].interactions", async () => {
    const badBody = http("POST", "/things", {
      request: {
        headers: { "Content-Type": ["application/json"] },
        body: { name: 42 },
      },
    });
    const results = await compare(
      { oas },
      pactOf(
        message("sendOrder"),
        badBody,
        message("sendOrder"),
        http("GET", "/missing"),
      ),
    );

    const errors = results.filter((r) => r.type === "error");
    expect(errors).toHaveLength(2);
    expect(errors[0].mockDetails.location).toMatch(
      /^\[root\]\.interactions\[1\]/,
    );
    expect(errors[0].code).toBe("request.body.incompatible");
    expect(ALLOW_LIST_CODES).not.toContain(errors[0].code);
    expect(errors[1].mockDetails.location).toMatch(
      /^\[root\]\.interactions\[3\]/,
    );
    expect(errors[1].code).toBe("request.path-or-method.unknown");
  });

  it("locates a Synchronous/Messages reply error by interaction index", async () => {
    const sync = {
      type: "Synchronous/Messages",
      description: "place an order",
      comments: { references: { AsyncAPI: { operationId: "sendOrder" } } },
      request: {
        contents: {
          content: { orderId: "o-1" },
          contentType: "application/json",
          encoded: false,
        },
      },
      response: [
        {
          contents: {
            content: { status: 7 },
            contentType: "application/json",
            encoded: false,
          },
        },
      ],
    };
    const results = await compare(
      { asyncapi },
      pactOf(message("sendOrder"), sync),
    );

    const errors = results.filter((r) => r.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].mockDetails.location).toMatch(
      /^\[root\]\.interactions\[1\]/,
    );
    expect(errors[0].code).toBe("message.no.match");
    expect(ALLOW_LIST_CODES).not.toContain(errors[0].code);
  });

  it("reports an unknown operationId on a Synchronous/Messages interaction as message.operation.unknown", async () => {
    const sync = {
      type: "Synchronous/Messages",
      description: "place an order",
      comments: {
        references: { AsyncAPI: { operationId: "noSuchOperation" } },
      },
      request: {
        contents: {
          content: { orderId: "o-1" },
          contentType: "application/json",
          encoded: false,
        },
      },
      response: [
        {
          contents: {
            content: { status: "ok" },
            contentType: "application/json",
            encoded: false,
          },
        },
      ],
    };
    const results = await compare(
      { asyncapi },
      pactOf(message("sendOrder"), sync),
    );

    const errors = results.filter((r) => r.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("message.operation.unknown");
    expect(errors[0].mockDetails.location).toMatch(
      /^\[root\]\.interactions\[1\]/,
    );
  });

  it("indexes interactions after dropping non-object entries", async () => {
    const results = await compare(
      { asyncapi },
      pactOf(
        null as never,
        message("sendOrder"),
        "text" as never,
        message("noSuchOperation"),
      ),
    );

    const errors = results.filter((r) => r.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("message.operation.unknown");
    // Non-object entries are removed first, so this is the second remaining interaction.
    expect(errors[0].mockDetails.location).toMatch(
      /^\[root\]\.interactions\[1\]/,
    );
  });

  it("emits no error for a passing HTTP interaction", async () => {
    const results = await compare({ oas }, pactOf(http("GET", "/orders")));

    expect(results.filter((r) => r.type === "error")).toEqual([]);
  });
});
