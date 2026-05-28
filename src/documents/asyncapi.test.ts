import { describe, expect, it } from "vitest";
import type { AsyncAPIDocument, ResolvedMessage } from "./asyncapi";
import {
  iterateMessages,
  iterateReplyMessages,
  ParserError,
  parse,
} from "./asyncapi";

const multiMessageDoc: AsyncAPIDocument = {
  asyncapi: "3.1.0",
  info: { title: "User Service", version: "1.0.0" },
  channels: {
    userEvents: {
      messages: {
        UserCreated: {
          messageId: "UserCreated",
          payload: {
            type: "object",
            properties: { userId: { type: "string" } },
            required: ["userId"],
          },
        },
        UserDeleted: {
          messageId: "UserDeleted",
          payload: {
            type: "object",
            properties: { userId: { type: "string" } },
          },
        },
      },
    },
    replies: {
      messages: {
        Ack: { messageId: "Ack", payload: { type: "object" } },
      },
    },
  },
  operations: {
    receiveUserEvents: {
      action: "receive",
      channel: { $ref: "#/channels/userEvents" },
      messages: [
        { $ref: "#/channels/userEvents/messages/UserCreated" },
        { $ref: "#/channels/userEvents/messages/UserDeleted" },
      ],
      reply: {
        channel: { $ref: "#/channels/replies" },
        messages: [{ $ref: "#/channels/replies/messages/Ack" }],
      },
    },
    noMessages: {
      action: "receive",
      channel: { $ref: "#/channels/userEvents" },
      messages: [],
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

describe("iterateMessages", () => {
  it("yields nothing for an unknown operation", () => {
    const results = [...iterateMessages(multiMessageDoc, "unknown", new Map())];
    expect(results).toHaveLength(0);
  });

  it("yields nothing when operation has no messages", () => {
    const results = [
      ...iterateMessages(multiMessageDoc, "noMessages", new Map()),
    ];
    expect(results).toHaveLength(0);
  });

  it("yields all messages in declaration order", () => {
    const results = [
      ...iterateMessages(multiMessageDoc, "receiveUserEvents", new Map()),
    ];
    expect(results).toHaveLength(2);
    expect(results[0].message).toMatchObject({ messageId: "UserCreated" });
    expect(results[1].message).toMatchObject({ messageId: "UserDeleted" });
  });

  it("resolves $ref paths to the component location", () => {
    const [first] = [
      ...iterateMessages(multiMessageDoc, "receiveUserEvents", new Map()),
    ];
    expect(first.path).toBe("[root].channels.userEvents.messages.UserCreated");
  });

  it("caches $ref resolutions and returns the same object reference", () => {
    const cache = new Map<string, ResolvedMessage>();
    const first = [
      ...iterateMessages(multiMessageDoc, "receiveUserEvents", cache),
    ];
    const second = [
      ...iterateMessages(multiMessageDoc, "receiveUserEvents", cache),
    ];
    expect(first[0]).toBe(second[0]);
  });

  it("stops at the first item when caller pulls only one", () => {
    const gen = iterateMessages(
      multiMessageDoc,
      "receiveUserEvents",
      new Map(),
    );
    const { value, done } = gen.next();
    expect(done).toBe(false);
    expect(value?.message.messageId).toBe("UserCreated");
    gen.return(undefined); // clean up the generator
  });
});

describe("iterateReplyMessages", () => {
  it("yields nothing for an unknown operation", () => {
    const results = [
      ...iterateReplyMessages(multiMessageDoc, "unknown", new Map()),
    ];
    expect(results).toHaveLength(0);
  });

  it("yields nothing when operation has no reply", () => {
    const results = [
      ...iterateReplyMessages(multiMessageDoc, "noMessages", new Map()),
    ];
    expect(results).toHaveLength(0);
  });

  it("yields reply messages", () => {
    const results = [
      ...iterateReplyMessages(multiMessageDoc, "receiveUserEvents", new Map()),
    ];
    expect(results).toHaveLength(1);
    expect(results[0].message).toMatchObject({ messageId: "Ack" });
  });

  it("resolves $ref paths to the component location", () => {
    const [first] = [
      ...iterateReplyMessages(multiMessageDoc, "receiveUserEvents", new Map()),
    ];
    expect(first.path).toBe("[root].channels.replies.messages.Ack");
  });

  it("caches $ref resolutions", () => {
    const cache = new Map<string, ResolvedMessage>();
    const first = [
      ...iterateReplyMessages(multiMessageDoc, "receiveUserEvents", cache),
    ];
    const second = [
      ...iterateReplyMessages(multiMessageDoc, "receiveUserEvents", cache),
    ];
    expect(first[0]).toBe(second[0]);
  });
});
