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
