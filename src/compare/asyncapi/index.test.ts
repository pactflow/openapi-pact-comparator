import Ajv from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { AsyncAPIDocument, Message } from "#documents/asyncapi";
import type { AsyncInteraction } from "#documents/pact";
import { compareAsyncInteraction } from "./index";

const makeAjv = () => {
  const ajv = new Ajv({ allErrors: true, strictSchema: false });
  addFormats(ajv);
  return ajv;
};

const baseDoc: AsyncAPIDocument = {
  asyncapi: "3.1.0",
  info: { title: "Events", version: "1.0.0" },
  channels: {
    eventsQueue: {
      messages: {
        orgDeleted: {
          messageId: "orgDeleted",
          payload: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        },
      },
    },
  },
  operations: {
    consume: {
      action: "receive",
      channel: { $ref: "#/channels/eventsQueue" },
      messages: [{ $ref: "#/channels/eventsQueue/messages/orgDeleted" }],
    },
  },
};

const validInteraction: AsyncInteraction = {
  _kind: "async",
  description: "org deleted",
  asyncapiReferences: { operationId: "consume", messageId: "orgDeleted" },
  payload: { id: "abc" },
  contentType: "application/json",
};

describe("compareAsyncInteraction", () => {
  it("yields no results for a valid interaction", () => {
    const results = Array.from(
      compareAsyncInteraction(
        makeAjv(),
        baseDoc,
        new Map(),
        validInteraction,
        0,
      ),
    );
    expect(results).toHaveLength(0);
  });

  it("yields message.spec.missing when no AAD provided", () => {
    const results = Array.from(
      compareAsyncInteraction(
        makeAjv(),
        undefined,
        new Map(),
        validInteraction,
        0,
      ),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.spec.missing");
    expect(results[0].type).toBe("error");
  });

  it("yields message.references.missing when asyncapiReferences absent", () => {
    const interaction: AsyncInteraction = {
      ...validInteraction,
      asyncapiReferences: undefined,
    };
    const results = Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.references.missing");
  });

  it("yields message.operation.unknown when operationId not in AAD", () => {
    const interaction: AsyncInteraction = {
      ...validInteraction,
      asyncapiReferences: {
        operationId: "nonExistent",
        messageId: "orgDeleted",
      },
    };
    const results = Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.operation.unknown");
  });

  it("yields message.id.unknown when messageId not found in operation", () => {
    const interaction: AsyncInteraction = {
      ...validInteraction,
      asyncapiReferences: {
        operationId: "consume",
        messageId: "nonExistentMsg",
      },
    };
    const results = Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.id.unknown");
  });

  it("yields payload errors when payload is invalid", () => {
    const interaction: AsyncInteraction = {
      ...validInteraction,
      payload: { id: 999 },
    };
    const results = Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.payload.incompatible");
  });

  it("shares cache across calls", () => {
    const cache = new Map<string, Message | null>();
    Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, cache, validInteraction, 0),
    );
    // cache should now contain the resolved message
    expect(cache.size).toBeGreaterThan(0);
    // second call with same cache should still resolve correctly
    const results = Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, cache, validInteraction, 1),
    );
    expect(results).toHaveLength(0);
  });
});
