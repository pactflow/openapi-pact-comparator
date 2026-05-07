import { describe, expect, it } from "vitest";
import { dereferenceDoc } from "./schema";

describe("dereferenceDoc", () => {
  it("returns schema unchanged when no $ref", () => {
    const schema = { type: "string" };
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
});
