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

// Two-operation pattern
const twoOpDoc: AsyncAPIDocument = {
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
    },
    receiveOrderResponse: {
      action: "receive",
      channel: { $ref: "#/channels/replies" },
      messages: [{ $ref: "#/channels/replies/messages/OrderResponse" }],
    },
  },
};

const validInteraction: SyncInteraction = {
  _kind: "sync",
  description: "place an order",
  asyncapiReferences: {
    requestOperationId: "sendOrder",
    requestMessageId: "OrderRequest",
    responseOperationId: "receiveOrderResponse",
    responseMessageId: "OrderResponse",
  },
  request: {
    payload: { orderId: "o-123" },
    contentType: "application/json",
  },
  responses: [
    {
      payload: { status: "accepted" },
      contentType: "application/json",
    },
  ],
};

describe("compareSyncInteraction", () => {
  it("yields no results for a valid two-operation interaction", () => {
    const results = Array.from(
      compareSyncInteraction(makeAjv(), twoOpDoc, new Map(), validInteraction, 0),
    );
    expect(results).toHaveLength(0);
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

  it("yields message.references.missing when interaction has no asyncapiReferences", () => {
    const interaction: SyncInteraction = { ...validInteraction, asyncapiReferences: undefined };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), twoOpDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.references.missing");
  });

  it("yields message.operation.unknown when request operation not found", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      asyncapiReferences: { ...validInteraction.asyncapiReferences!, requestOperationId: "noSuchOp" },
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), twoOpDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.operation.unknown");
  });

  it("yields message.id.unknown when request messageId not found", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      asyncapiReferences: { ...validInteraction.asyncapiReferences!, requestMessageId: "NoSuchMsg" },
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), twoOpDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.id.unknown");
  });

  it("yields message.payload.incompatible when request payload violates required field", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      request: { ...validInteraction.request, payload: {} }, // missing required orderId
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), twoOpDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.payload.incompatible");
  });

  it("yields message.operation.unknown when response operation not found", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      asyncapiReferences: { ...validInteraction.asyncapiReferences!, responseOperationId: "noSuchOp" },
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), twoOpDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.operation.unknown");
  });

  it("yields message.id.unknown when response messageId not found in response operation", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      asyncapiReferences: { ...validInteraction.asyncapiReferences!, responseMessageId: "NoSuchMsg" },
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), twoOpDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.id.unknown");
  });

  it("yields no error when response payload omits required spec fields (consumer asserts subset)", () => {
    const interaction: SyncInteraction = {
      ...validInteraction,
      responses: [{ payload: {}, contentType: "application/json" }], // missing required status — OK for response direction
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), twoOpDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(0);
  });

  it("yields message.reply.missing when operation has no reply and no responseOperationId", () => {
    const docNoReply: AsyncAPIDocument = {
      ...twoOpDoc,
      operations: {
        sendOrder: twoOpDoc.operations!.sendOrder, // no reply field
      },
    };
    const replyFieldInteraction: SyncInteraction = {
      ...validInteraction,
      asyncapiReferences: {
        requestOperationId: "sendOrder",
        requestMessageId: "OrderRequest",
        // no responseOperationId — should use operation.reply
        responseMessageId: "OrderResponse",
      },
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), docNoReply, new Map(), replyFieldInteraction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.reply.missing");
  });

  it("yields message.reply.id.unknown when responseMessageId not found in operation.reply", () => {
    const docWithReply: AsyncAPIDocument = {
      ...twoOpDoc,
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
    const interaction: SyncInteraction = {
      ...validInteraction,
      asyncapiReferences: {
        requestOperationId: "sendOrder",
        requestMessageId: "OrderRequest",
        // no responseOperationId — uses reply field
        responseMessageId: "NoSuchReplyMsg",
      },
    };
    const results = Array.from(
      compareSyncInteraction(makeAjv(), docWithReply, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.reply.id.unknown");
  });
});
