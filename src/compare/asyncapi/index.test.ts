import Ajv from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { AsyncAPIDocument } from "#documents/asyncapi";
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
  asyncapiReferences: { operationId: "consume" },
  payload: { id: "abc" },
  contentType: "application/json",
};

describe("compareAsyncInteraction", () => {
  it("yields message.matched info for a valid interaction", () => {
    const results = Array.from(
      compareAsyncInteraction(
        makeAjv(),
        baseDoc,
        new Map(),
        validInteraction,
        0,
      ),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.matched");
    expect(results[0].type).toBe("info");
  });

  it("yields message.spec.missing when no asyncapi doc provided", () => {
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

  it("yields message.operation.unknown when operationId not in spec", () => {
    const interaction: AsyncInteraction = {
      ...validInteraction,
      asyncapiReferences: { operationId: "nonExistent" },
    };
    const results = Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.operation.unknown");
  });

  it("yields message.no.match with causes when payload is invalid", () => {
    const interaction: AsyncInteraction = {
      ...validInteraction,
      payload: { id: 999 }, // id must be string
    };
    const results = Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, new Map(), interaction, 0),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.no.match");
    expect(results[0].causes).toBeDefined();
    expect(results[0].causes![0].code).toBe("message.payload.incompatible");
  });

  it("yields message.no.match with empty causes when operation has no messages", () => {
    const docNoMessages: AsyncAPIDocument = {
      ...baseDoc,
      operations: {
        consume: { ...baseDoc.operations!.consume, messages: [] },
      },
    };
    const results = Array.from(
      compareAsyncInteraction(
        makeAjv(),
        docNoMessages,
        new Map(),
        validInteraction,
        0,
      ),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.no.match");
    expect(results[0].causes).toEqual([]);
  });

  it("caches resolved messages across calls", () => {
    const cache = new Map<
      string,
      import("#documents/asyncapi").ResolvedMessage
    >();
    Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, cache, validInteraction, 0),
    );
    expect(cache.size).toBeGreaterThan(0);
    const results = Array.from(
      compareAsyncInteraction(makeAjv(), baseDoc, cache, validInteraction, 1),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.matched");
  });
});
