import Ajv from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { AsyncAPIDocument } from "#documents/asyncapi";
import type { SyncInteraction } from "#documents/pact";
import { compareSyncInteraction } from "./syncMessage";

const makeAjv = () => {
  const ajv = new Ajv({ allErrors: true, strictSchema: false });
  addFormats(ajv);
  return ajv;
};

const doc: AsyncAPIDocument = {
  asyncapi: "3.1.0",
  info: { title: "Order Service", version: "1.0.0" },
  channels: {
    requests: {
      messages: {
        OrderRequest: {
          messageId: "OrderRequest",
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
          messageId: "OrderResponse",
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
    sendOrderNoReply: {
      action: "send",
      channel: { $ref: "#/channels/requests" },
      messages: [{ $ref: "#/channels/requests/messages/OrderRequest" }],
    },
  },
};

const validInteraction: SyncInteraction = {
  _kind: "sync",
  description: "place an order",
  asyncapiReferences: { operationId: "sendOrder" },
  request: { payload: { orderId: "o-123" }, contentType: "application/json" },
  responses: [
    { payload: { status: "accepted" }, contentType: "application/json" },
  ],
};

describe("compareSyncInteraction", () => {
  it("yields message.matched info for both request and response when valid", () => {
    const results = Array.from(
      compareSyncInteraction(makeAjv(), doc, new Map(), validInteraction, 0),
    );
    expect(results).toHaveLength(2);
    expect(results[0].code).toBe("message.matched");
    expect(results[0].type).toBe("info");
    expect(results[1].code).toBe("message.matched");
    expect(results[1].type).toBe("info");
  });

  it("yields message.spec.missing when no asyncapi doc provided", () => {
    const results = Array.from(
      compareSyncInteraction(
        makeAjv(),
        undefined,
        new Map(),
        validInteraction,
        0,
      ),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.spec.missing");
  });

  it("yields message.references.missing when asyncapiReferences absent", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      asyncapiReferences: undefined,
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), doc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.references.missing");
  });

  it("yields message.operation.unknown when operationId not in spec", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      asyncapiReferences: { operationId: "noSuchOp" },
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), doc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.operation.unknown");
  });

  it("yields message.no.match with causes when request payload is invalid", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      request: { ...validInteraction.request, payload: {} }, // missing required orderId
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), doc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.no.match");
    expect(results[0].causes![0].code).toBe("message.payload.incompatible");
  });

  it("stops after request failure and does not validate response", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      request: { ...validInteraction.request, payload: {} },
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), doc, new Map(), interaction, 0),
    );
    // Only one result (the request no-match) — response is never checked
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.no.match");
  });

  it("yields message.reply.missing when operation has no reply field", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      asyncapiReferences: { operationId: "sendOrderNoReply" },
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), doc, new Map(), interaction, 0),
    );
    // First result: message.matched for request; second: message.reply.missing
    expect(results).toHaveLength(2);
    expect(results[0].code).toBe("message.matched");
    expect(results[1].code).toBe("message.reply.missing");
  });

  it("yields message.no.match with causes when response payload does not match", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      responses: [{ payload: { status: 42 }, contentType: "application/json" }], // status must be string
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), doc, new Map(), interaction, 0),
    );
    // request: message.matched; response: message.no.match
    expect(results).toHaveLength(2);
    expect(results[0].code).toBe("message.matched");
    expect(results[1].code).toBe("message.no.match");
    expect(results[1].causes![0].code).toBe("message.payload.incompatible");
  });

  it("yields no error when response payload omits optional spec fields", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      responses: [{ payload: {}, contentType: "application/json" }],
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), doc, new Map(), interaction, 0),
    );
    // Both request and response match (response direction doesn't enforce required)
    expect(results.every((r) => r.code === "message.matched")).toBe(true);
  });

  it("validates each response entry independently", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      responses: [
        { payload: { status: "ok" }, contentType: "application/json" },
        { payload: { status: 42 }, contentType: "application/json" }, // invalid
      ],
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), doc, new Map(), interaction, 0),
    );
    // request: matched; response[0]: matched; response[1]: no.match
    expect(results).toHaveLength(3);
    expect(results[0].code).toBe("message.matched"); // request
    expect(results[1].code).toBe("message.matched"); // response[0]
    expect(results[2].code).toBe("message.no.match"); // response[1]
  });

  // Multi-message: operation has two request candidates
  it("matches second request candidate when first fails", () => {
    const multiDoc: AsyncAPIDocument = {
      ...doc,
      channels: {
        ...doc.channels,
        requests: {
          messages: {
            OrderRequest: doc.channels!.requests!.messages!.OrderRequest,
            SimpleRequest: {
              messageId: "SimpleRequest",
              payload: { type: "object" }, // accepts anything
            },
          },
        },
      },
      operations: {
        sendOrder: {
          ...doc.operations!.sendOrder,
          messages: [
            { $ref: "#/channels/requests/messages/OrderRequest" }, // requires orderId
            { $ref: "#/channels/requests/messages/SimpleRequest" }, // accepts anything
          ],
        },
      },
    };
    const interaction: SyncInteraction = {
      ...validInteraction,
      request: { payload: {}, contentType: "application/json" }, // fails OrderRequest, passes SimpleRequest
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), multiDoc, new Map(), interaction, 0),
    );
    expect(results[0].code).toBe("message.matched"); // SimpleRequest matched
    expect(results[0].specDetails?.location).toContain("SimpleRequest");
  });
});
