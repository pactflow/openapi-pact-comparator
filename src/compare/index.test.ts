import { describe, expect, it } from "vitest";

import type { AsyncAPIDocument } from "#documents/asyncapi";
import { ParserError } from "#documents/oas";
import type { Pact } from "#documents/pact";
import type { Result } from "#results/index";

import { Comparator } from "./index";

describe("Comparator constructor", () => {
  describe("ComparatorOptions input", () => {
    it("accepts an empty options object without throwing", () => {
      expect(() => new Comparator({})).not.toThrow();
    });

    it("accepts options with only an oas key", () => {
      expect(
        () =>
          new Comparator({
            oas: {
              openapi: "3.0.0",
              info: { title: "T", version: "1" },
              paths: {},
            },
          }),
      ).not.toThrow();
    });

    it("throws ParserError when oas value is malformed", () => {
      expect(() => new Comparator({ oas: { paths: {} } as never })).toThrow(
        ParserError,
      );
    });

    it("accepts options with only an asyncapi key (no oas validation)", () => {
      expect(() => new Comparator({ asyncapi: undefined })).not.toThrow();
    });
  });
});

describe("Comparator.compare routing", () => {
  it("routes Synchronous/Messages interactions to compareSyncInteraction", async () => {
    const asyncapi: AsyncAPIDocument = {
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

    const pact: Pact = {
      consumer: { name: "consumer" },
      provider: { name: "provider" },
      interactions: [
        {
          type: "Synchronous/Messages",
          description: "place an order",
          comments: {
            references: {
              AsyncAPI: {
                operationId: "sendOrder",
              },
            },
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
                content: { status: "accepted" },
                contentType: "application/json",
                encoded: false,
              },
            },
          ],
        } as unknown as Pact["interactions"][number],
      ],
      metadata: { pactSpecification: { version: "4.0" } },
    };

    const comparator = new Comparator({ asyncapi });
    const results: Result[] = [];
    for await (const r of comparator.compare(pact)) {
      results.push(r);
    }
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ code: "message.matched", type: "info" });
    expect(results[1]).toMatchObject({ code: "message.matched", type: "info" });
  });
});

describe("Comparator isolation", () => {
  // Both documents share the very same message object, but resolve its $ref
  // against different components, so nothing may be carried between Comparators.
  const message = { payload: { $ref: "#/components/schemas/Count" } };
  const docWith = (countType: string): AsyncAPIDocument =>
    ({
      asyncapi: "3.0.0",
      info: { title: "Counter", version: "1.0.0" },
      components: { schemas: { Count: { type: countType } } },
      channels: { main: { messages: { Count: message } } },
      operations: {
        receiveCount: {
          action: "receive",
          channel: { $ref: "#/channels/main" },
          messages: [{ $ref: "#/channels/main/messages/Count" }],
        },
      },
    }) as unknown as AsyncAPIDocument;

  const pact = {
    metadata: { pactSpecification: { version: "4.0" } },
    interactions: [
      {
        type: "Asynchronous/Messages",
        description: "a count",
        comments: {
          references: { AsyncAPI: { operationId: "receiveCount" } },
        },
        contents: {
          content: 5,
          contentType: "application/json",
          encoded: false,
        },
      },
    ],
  } as unknown as Pact;

  const codes = async (asyncapi: AsyncAPIDocument) => {
    const results: Result[] = [];
    for await (const result of new Comparator({ asyncapi }).compare(pact)) {
      results.push(result);
    }
    return results.map((r) => r.code);
  };

  it("does not reuse resolved messages across Comparators", async () => {
    expect(await codes(docWith("string"))).toEqual(["message.no.match"]);
    expect(await codes(docWith("integer"))).toEqual(["message.matched"]);
    expect(await codes(docWith("string"))).toEqual(["message.no.match"]);
  });
});
