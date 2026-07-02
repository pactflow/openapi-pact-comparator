import { describe, expect, it } from "vitest";
import { dereferenceDoc, lastRefInChain } from "./schema";

describe("dereferenceDoc", () => {
  it("returns schema unchanged when no $ref", () => {
    const schema = { type: "string" } as { $ref?: string };
    const doc = { components: { schemas: { Foo: { type: "integer" } } } };
    expect(dereferenceDoc(schema, doc)).toBe(schema);
  });

  it("resolves $ref against arbitrary document path", () => {
    const doc = {
      components: {
        schemas: {
          Bar: { type: "object", properties: { id: { type: "string" } } },
        },
      },
    };
    const schema = { $ref: "#/components/schemas/Bar" };
    expect(dereferenceDoc(schema, doc)).toBe(doc.components.schemas.Bar);
  });

  it("resolves $ref using non-OAS path (AsyncAPI #/channels/...)", () => {
    const doc = {
      channels: {
        "user/signedup": {
          subscribe: {
            message: { payload: { type: "object" } },
          },
        },
      },
    };
    const schema = { $ref: "#/channels/user~1signedup/subscribe/message" };
    expect(dereferenceDoc(schema, doc)).toBe(
      doc.channels["user/signedup"].subscribe.message,
    );
  });

  it("returns undefined when $ref cannot be resolved", () => {
    const doc = { components: { schemas: {} } };
    const schema = { $ref: "#/components/schemas/Missing" };
    expect(dereferenceDoc(schema, doc)).toBeUndefined();
  });

  it("follows a chain of $refs to the terminal value", () => {
    const doc = {
      channels: {
        userEvents: {
          messages: {
            userCreated: { $ref: "#/components/messages/userCreated" },
          },
        },
      },
      components: {
        messages: { userCreated: { payload: { type: "object" } } },
      },
    };
    const schema = { $ref: "#/channels/userEvents/messages/userCreated" };
    expect(dereferenceDoc(schema, doc)).toBe(
      doc.components.messages.userCreated,
    );
  });

  it("returns undefined on a circular $ref chain", () => {
    const doc = {
      components: {
        messages: {
          A: { $ref: "#/components/messages/B" },
          B: { $ref: "#/components/messages/A" },
        },
      },
    };
    expect(
      dereferenceDoc({ $ref: "#/components/messages/A" }, doc),
    ).toBeUndefined();
  });
});

describe("lastRefInChain", () => {
  it("returns undefined when no $ref", () => {
    expect(
      lastRefInChain({ type: "string" } as { $ref?: string }, {}),
    ).toBeUndefined();
  });

  it("returns the $ref for a single hop", () => {
    const doc = { components: { schemas: { Foo: { type: "object" } } } };
    expect(lastRefInChain({ $ref: "#/components/schemas/Foo" }, doc)).toBe(
      "#/components/schemas/Foo",
    );
  });

  it("returns the final $ref in a multi-hop chain", () => {
    const doc = {
      channels: {
        userEvents: {
          messages: {
            userCreated: { $ref: "#/components/messages/userCreated" },
          },
        },
      },
      components: {
        messages: { userCreated: { payload: { type: "object" } } },
      },
    };
    expect(
      lastRefInChain(
        { $ref: "#/channels/userEvents/messages/userCreated" },
        doc,
      ),
    ).toBe("#/components/messages/userCreated");
  });

  it("returns undefined on a circular $ref chain", () => {
    const doc = {
      components: {
        messages: {
          A: { $ref: "#/components/messages/B" },
          B: { $ref: "#/components/messages/A" },
        },
      },
    };
    expect(
      lastRefInChain({ $ref: "#/components/messages/A" }, doc),
    ).toBeUndefined();
  });
});
