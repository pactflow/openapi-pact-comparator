import { describe, expect, it } from "vitest";
import type { AsyncAPIDocument, Ref } from "./asyncapi";
import { ParserError, parse, resolveMessage } from "./asyncapi";

const baseDoc: AsyncAPIDocument = {
  asyncapi: "3.1.0",
  info: { title: "Test Events", version: "1.0.0" },
  channels: {
    eventsQueue: {
      messages: {
        organizationDeleted: {
          messageId: "organizationDeleted",
          payload: {
            type: "object",
            properties: { organizationId: { type: "string" } },
            required: ["organizationId"],
          },
          headers: {
            type: "object",
            properties: { "detail-type": { type: "string" } },
          },
        },
      },
    },
  },
  operations: {
    consumeFromEventsQueue: {
      action: "receive",
      channel: { $ref: "#/channels/eventsQueue" },
      messages: [
        { $ref: "#/channels/eventsQueue/messages/organizationDeleted" },
      ],
    },
  },
};

describe("parse", () => {
  it("accepts AsyncAPI 3.0 documents", () => {
    expect(() =>
      parse({
        asyncapi: "3.0.0",
        info: { title: "T", version: "1" },
      } as AsyncAPIDocument),
    ).not.toThrow();
  });

  it("accepts AsyncAPI 3.1 documents", () => {
    expect(() =>
      parse({
        asyncapi: "3.1.0",
        info: { title: "T", version: "1" },
      } as AsyncAPIDocument),
    ).not.toThrow();
  });

  it("rejects AsyncAPI 2.x documents", () => {
    expect(() =>
      parse({
        asyncapi: "2.6.0",
        info: { title: "T", version: "1" },
      } as AsyncAPIDocument),
    ).toThrow(ParserError);
  });

  it("rejects documents without asyncapi field", () => {
    expect(() => parse({} as AsyncAPIDocument)).toThrow(ParserError);
  });

  it("rejects documents where asyncapi is not a string", () => {
    expect(() => parse({ asyncapi: 3 } as unknown as AsyncAPIDocument)).toThrow(
      ParserError,
    );
  });

  it("rejects nullish documents", () => {
    expect(() => parse(null as unknown as AsyncAPIDocument)).toThrow(
      ParserError,
    );
    expect(() => parse(undefined as unknown as AsyncAPIDocument)).toThrow(
      ParserError,
    );
  });
});

describe("resolveMessage", () => {
  it("resolves a message by messageId field", () => {
    const cache = new Map();
    const msg = resolveMessage(
      baseDoc,
      "consumeFromEventsQueue",
      "organizationDeleted",
      cache,
    );
    expect(msg).not.toBeNull();
    expect(msg?.message.messageId).toBe("organizationDeleted");
    expect(msg?.path).toBe(
      "[root].channels.eventsQueue.messages.organizationDeleted",
    );
  });

  it("returns null for unknown operationId", () => {
    const msg = resolveMessage(
      baseDoc,
      "unknownOp",
      "organizationDeleted",
      new Map(),
    );
    expect(msg).toBeNull();
  });

  it("returns null for unknown messageId", () => {
    const msg = resolveMessage(
      baseDoc,
      "consumeFromEventsQueue",
      "unknownMsg",
      new Map(),
    );
    expect(msg).toBeNull();
  });

  it("caches results so the same key is not re-resolved", () => {
    const cache = new Map();
    resolveMessage(
      baseDoc,
      "consumeFromEventsQueue",
      "organizationDeleted",
      cache,
    );
    expect(
      cache.has(
        JSON.stringify(["consumeFromEventsQueue", "organizationDeleted"]),
      ),
    ).toBe(true);
    // Mutate doc — cached result should still be returned
    const docCopy = { ...baseDoc, operations: {} };
    const msg = resolveMessage(
      docCopy,
      "consumeFromEventsQueue",
      "organizationDeleted",
      cache,
    );
    expect(msg).not.toBeNull();
  });

  it("resolves by $ref key when message has no messageId field", () => {
    const docNoId: AsyncAPIDocument = {
      ...baseDoc,
      channels: {
        eventsQueue: {
          messages: {
            organizationDeleted: {
              // no messageId field
              payload: { type: "object" },
            },
          },
        },
      },
    };
    const msg = resolveMessage(
      docNoId,
      "consumeFromEventsQueue",
      "organizationDeleted",
      new Map(),
    );
    expect(msg).not.toBeNull();
  });

  it("resolves inline message objects by messageId", () => {
    const docInline: AsyncAPIDocument = {
      ...baseDoc,
      operations: {
        consumeFromEventsQueue: {
          action: "receive",
          channel: { $ref: "#/channels/eventsQueue" },
          messages: [
            {
              messageId: "organizationDeleted",
              payload: { type: "object" },
            },
          ],
        },
      },
    };
    const msg = resolveMessage(
      docInline,
      "consumeFromEventsQueue",
      "organizationDeleted",
      new Map(),
    );
    expect(msg).not.toBeNull();
    expect(msg?.message.messageId).toBe("organizationDeleted");
    expect(msg?.path).toBe(
      "[root].operations.consumeFromEventsQueue.messages[0]",
    );
  });

  it("caches null for unresolved messages", () => {
    const cache = new Map();
    resolveMessage(baseDoc, "consumeFromEventsQueue", "nope", cache);
    expect(
      cache.get(JSON.stringify(["consumeFromEventsQueue", "nope"])),
    ).toBeNull();
  });

  it("safely handles malformed operation message refs where $ref is missing", () => {
    const docMalformed: AsyncAPIDocument = {
      ...baseDoc,
      operations: {
        consumeFromEventsQueue: {
          action: "receive",
          channel: { $ref: "#/channels/eventsQueue" },
          messages: [
            {} as Ref,
            { $ref: "#/channels/eventsQueue/messages/organizationDeleted" },
          ],
        },
      },
    };
    expect(() =>
      resolveMessage(
        docMalformed,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).not.toThrow();
    const msg = resolveMessage(
      docMalformed,
      "consumeFromEventsQueue",
      "organizationDeleted",
      new Map(),
    );
    expect(msg).not.toBeNull();
    expect(msg?.message.messageId).toBe("organizationDeleted");
  });

  it("safely handles malformed operation message refs where $ref is not a string", () => {
    const docMalformed: AsyncAPIDocument = {
      ...baseDoc,
      operations: {
        consumeFromEventsQueue: {
          action: "receive",
          channel: { $ref: "#/channels/eventsQueue" },
          messages: [{ $ref: 42 } as unknown as Ref],
        },
      },
    };
    expect(() =>
      resolveMessage(
        docMalformed,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).not.toThrow();
    const msg = resolveMessage(
      docMalformed,
      "consumeFromEventsQueue",
      "organizationDeleted",
      new Map(),
    );
    expect(msg).toBeNull();
  });

  it("safely handles null entries in operation.messages", () => {
    const docNullEntry: AsyncAPIDocument = {
      ...baseDoc,
      operations: {
        consumeFromEventsQueue: {
          action: "receive",
          channel: { $ref: "#/channels/eventsQueue" },
          messages: [null as unknown as Ref],
        },
      },
    };
    expect(() =>
      resolveMessage(
        docNullEntry,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).not.toThrow();
    expect(
      resolveMessage(
        docNullEntry,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).toBeNull();
  });

  it("safely handles numeric entries in operation.messages", () => {
    const docNumericEntry: AsyncAPIDocument = {
      ...baseDoc,
      operations: {
        consumeFromEventsQueue: {
          action: "receive",
          channel: { $ref: "#/channels/eventsQueue" },
          messages: [42 as unknown as Ref],
        },
      },
    };
    expect(() =>
      resolveMessage(
        docNumericEntry,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).not.toThrow();
    expect(
      resolveMessage(
        docNumericEntry,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).toBeNull();
  });

  it("resolves valid ref after skipping mixed malformed entries", () => {
    const docMixed: AsyncAPIDocument = {
      ...baseDoc,
      operations: {
        consumeFromEventsQueue: {
          action: "receive",
          channel: { $ref: "#/channels/eventsQueue" },
          messages: [
            null as unknown as Ref,
            42 as unknown as Ref,
            {} as Ref,
            { $ref: 99 } as unknown as Ref,
            { $ref: "#/channels/eventsQueue/messages/organizationDeleted" },
          ],
        },
      },
    };
    expect(() =>
      resolveMessage(
        docMixed,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).not.toThrow();
    const msg = resolveMessage(
      docMixed,
      "consumeFromEventsQueue",
      "organizationDeleted",
      new Map(),
    );
    expect(msg).not.toBeNull();
    expect(msg?.message.messageId).toBe("organizationDeleted");
  });

  it("returns null without throwing when operation.messages is a plain object (non-array)", () => {
    const docObjectMessages: AsyncAPIDocument = {
      ...baseDoc,
      operations: {
        consumeFromEventsQueue: {
          action: "receive",
          channel: { $ref: "#/channels/eventsQueue" },
          messages: { key: "value" } as unknown as Array<Ref>,
        },
      },
    };
    expect(() =>
      resolveMessage(
        docObjectMessages,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).not.toThrow();
    expect(
      resolveMessage(
        docObjectMessages,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).toBeNull();
  });

  it("returns null without throwing when operation.messages is a string (non-array)", () => {
    const docStringMessages: AsyncAPIDocument = {
      ...baseDoc,
      operations: {
        consumeFromEventsQueue: {
          action: "receive",
          channel: { $ref: "#/channels/eventsQueue" },
          messages: "invalid" as unknown as Array<Ref>,
        },
      },
    };
    expect(() =>
      resolveMessage(
        docStringMessages,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).not.toThrow();
    expect(
      resolveMessage(
        docStringMessages,
        "consumeFromEventsQueue",
        "organizationDeleted",
        new Map(),
      ),
    ).toBeNull();
  });

  it("does not collide when operationId and messageId share a common separator", () => {
    // With a naive `${opId}:${msgId}` key, ("op:A","B") and ("op","A:B") would collide.
    // JSON.stringify tuple keying must keep them distinct.
    const cache = new Map();
    // Populate with a result for ("op:A", "B") — null because op doesn't exist in baseDoc
    resolveMessage(baseDoc, "op:A", "B", cache);
    // Populate with a result for ("op", "A:B") — also null
    resolveMessage(baseDoc, "op", "A:B", cache);
    const key1 = JSON.stringify(["op:A", "B"]);
    const key2 = JSON.stringify(["op", "A:B"]);
    expect(key1).not.toBe(key2);
    expect(cache.has(key1)).toBe(true);
    expect(cache.has(key2)).toBe(true);
  });
});
