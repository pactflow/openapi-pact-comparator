import { describe, expect, it } from "vitest";

import type { AsyncAPIDocument, ResolvedMessage } from "./asyncapi";
import {
  iterateMessages,
  iterateReplyMessages,
  parse,
  ParserError,
  unwrapMultiFormatSchema,
} from "./asyncapi";

const multiMessageDoc: AsyncAPIDocument = {
  asyncapi: "3.1.0",
  info: { title: "User Service", version: "1.0.0" },
  channels: {
    userEvents: {
      messages: {
        UserCreated: {
          payload: {
            type: "object",
            properties: { userId: { type: "string" } },
            required: ["userId"],
          },
        },
        UserDeleted: {
          payload: {
            type: "object",
            properties: { userId: { type: "string" } },
          },
        },
      },
    },
    replies: {
      messages: {
        Ack: { payload: { type: "object" } },
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
    expect(results[0].path).toBe(
      "[root].channels.userEvents.messages.UserCreated",
    );
    expect(results[1].path).toBe(
      "[root].channels.userEvents.messages.UserDeleted",
    );
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

  it("follows a two-hop $ref chain (operation → channel alias → components/messages)", () => {
    const twoHopDoc: AsyncAPIDocument = {
      asyncapi: "3.1.0",
      info: { title: "T", version: "1" },
      channels: {
        musicEvents: {
          messages: {
            musicEventPublished: {
              $ref: "#/components/messages/MusicEventPublished",
            } as import("./asyncapi").Ref,
          },
        },
      },
      operations: {
        publishMusicEvent: {
          action: "send",
          channel: { $ref: "#/channels/musicEvents" },
          messages: [
            { $ref: "#/channels/musicEvents/messages/musicEventPublished" },
          ],
        },
      },
      components: {
        messages: {
          MusicEventPublished: {
            payload: { type: "object", properties: { id: { type: "string" } } },
          },
        },
      },
    };

    const results = [
      ...iterateMessages(twoHopDoc, "publishMusicEvent", new Map()),
    ];
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe(
      "[root].components.messages.MusicEventPublished",
    );
    expect(results[0].message.payload).toBeDefined();
  });

  it("stops at the first item when caller pulls only one", () => {
    const gen = iterateMessages(
      multiMessageDoc,
      "receiveUserEvents",
      new Map(),
    );
    const { value, done } = gen.next();
    expect(done).toBe(false);
    expect(value?.path).toBe("[root].channels.userEvents.messages.UserCreated");
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

describe("unwrapMultiFormatSchema", () => {
  const schema = { type: "object", properties: { id: { type: "string" } } };

  it("returns a plain schema unchanged", () => {
    expect(unwrapMultiFormatSchema(schema)).toEqual({
      status: "schema",
      schema,
      path: "",
    });
  });

  it.each([
    "application/vnd.aai.asyncapi;version=3.0.0",
    "application/vnd.aai.asyncapi+json;version=3.0.0",
    "application/vnd.aai.asyncapi+yaml;version=2.6.0",
    "application/vnd.aai.asyncapi",
    "application/schema+json;version=draft-07",
    "application/schema+yaml;version=draft-2019-09",
    " Application/Schema+JSON ; version=draft-07 ",
  ])("unwraps the schema for supported format %s", (schemaFormat) => {
    expect(unwrapMultiFormatSchema({ schemaFormat, schema })).toEqual({
      status: "schema",
      schema,
      path: ".schema",
    });
  });

  it.each([
    "application/raml+yaml;version=1.0",
    "application/x-unknown",
    "application/schema+json;version=draft-04",
    "application/schema+yaml;version=draft-2020-12",
  ])("reports unsupported format %s", (schemaFormat) => {
    expect(unwrapMultiFormatSchema({ schemaFormat, schema })).toEqual({
      status: "unsupported",
      schemaFormat,
    });
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["a string", "{}"],
  ])("returns no schema when a supported format's schema is %s", (_, value) => {
    expect(
      unwrapMultiFormatSchema({
        schemaFormat: "application/vnd.aai.asyncapi;version=3.0.0",
        schema: value,
      }),
    ).toEqual({ status: "schema", schema: undefined, path: ".schema" });
  });
});

describe("unwrapMultiFormatSchema: Avro and Protobuf", () => {
  const AVRO = "application/vnd.apache.avro;version=1.9.0";
  const PROTO = "application/vnd.google.protobuf;version=3";
  const proto = `syntax = "proto3"; message A { string a = 1; } message B { string b = 1; }`;
  const avro = {
    type: "record",
    name: "A",
    fields: [{ name: "a", type: "string" }],
  };

  it("converts Avro to JSON Schema", () => {
    expect(
      unwrapMultiFormatSchema({ schemaFormat: AVRO, schema: avro }),
    ).toEqual({
      status: "schema",
      schema: {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      },
      path: ".schema",
    });
  });

  it("converts Protobuf to JSON Schema, choosing the message by name", () => {
    expect(
      unwrapMultiFormatSchema({ schemaFormat: PROTO, schema: proto }, ["b"]),
    ).toMatchObject({
      status: "schema",
      schema: { properties: { b: { type: "string" } } },
      path: ".schema",
    });
  });

  it("converts a wrapper shared by several messages once per message", () => {
    // $refs are resolved per message, so each message has its own copy
    const a = { schemaFormat: PROTO, schema: proto };
    const b = { schemaFormat: PROTO, schema: proto };
    expect(unwrapMultiFormatSchema(a, ["A"])).toMatchObject({
      schema: { properties: { a: { type: "string" } } },
    });
    expect(unwrapMultiFormatSchema(b, ["B"])).toMatchObject({
      schema: { properties: { b: { type: "string" } } },
    });
  });

  it("does not convert the same value twice", () => {
    const wrapper = { schemaFormat: AVRO, schema: avro };
    expect(unwrapMultiFormatSchema(wrapper)).toBe(
      unwrapMultiFormatSchema(wrapper),
    );
  });

  it("does not modify the wrapper", () => {
    const wrapper = { schemaFormat: AVRO, schema: structuredClone(avro) };
    const copy = structuredClone(wrapper);
    unwrapMultiFormatSchema(wrapper);
    expect(wrapper).toEqual(copy);
  });

  it.each([
    ["an unresolved Avro $ref", AVRO, undefined, /no Avro schema available/],
    [
      "a JSON Schema in an Avro wrapper",
      AVRO,
      { type: "object" },
      /invalid Avro/,
    ],
    ["an unparseable Avro string", AVRO, "{not json", /invalid Avro/],
    [
      "an unresolved Protobuf $ref",
      PROTO,
      undefined,
      /no Protobuf schema available/,
    ],
    [
      "a Protobuf schema that is not a string",
      PROTO,
      { type: "object" },
      /no Protobuf schema available/,
    ],
    ["invalid Protobuf source", PROTO, "message {", /invalid Protobuf/],
    [
      "a Protobuf message that cannot be chosen",
      PROTO,
      proto,
      /cannot choose a Protobuf message for 'Unrelated'/,
    ],
  ])(
    "reports %s as unsupported, with a reason",
    (_, schemaFormat, schema, reason) => {
      const result = unwrapMultiFormatSchema({ schemaFormat, schema }, [
        "Unrelated",
      ]);
      expect(result).toMatchObject({ status: "unsupported", schemaFormat });
      expect((result as { reason: string }).reason).toMatch(reason);
    },
  );
});
