import Ajv from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { Message } from "#documents/asyncapi";
import type { AsyncInteraction } from "#documents/pact";
import { compareMessageHeaders } from "./messageHeaders";

const makeAjv = () => {
  const ajv = new Ajv({ allErrors: true, strictSchema: false });
  addFormats(ajv);
  return ajv;
};

const baseInteraction: AsyncInteraction = {
  _kind: "async",
  description: "an event",
  providerState: undefined,
  asyncapiReferences: { operationId: "consumeOp", messageId: "myMsg" },
  payload: { organizationId: "abc-123" },
  contentType: "application/json",
  metadata: {
    "detail-type": "organization-deleted",
    time: "2024-02-06T18:36:26.102Z",
  },
};

const baseMessage: Message = {
  messageId: "myMsg",
  headers: {
    type: "object",
    properties: {
      "detail-type": { type: "string" },
      time: { type: "string" },
    },
    required: ["detail-type"],
  },
};

describe("compareMessageHeaders", () => {
  it("yields no results when metadata matches schema", () => {
    const results = Array.from(
      compareMessageHeaders(
        makeAjv(),
        baseMessage,
        baseInteraction,
        0,
        "consumeOp",
        "myMsg",
      ),
    );
    expect(results).toHaveLength(0);
  });

  it("yields message.headers.incompatible when metadata fails schema", () => {
    const interaction: AsyncInteraction = {
      ...baseInteraction,
      metadata: { "detail-type": 12345 as unknown as string },
    };
    const results = Array.from(
      compareMessageHeaders(
        makeAjv(),
        baseMessage,
        interaction,
        0,
        "consumeOp",
        "myMsg",
      ),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.headers.incompatible");
    expect(results[0].type).toBe("error");
    expect(results[0].mockDetails?.location).toBe(
      "[root].interactions[0].metadata.detail-type",
    );
  });

  it("yields no results when message has no headers schema", () => {
    const message: Message = { messageId: "myMsg" };
    const results = Array.from(
      compareMessageHeaders(
        makeAjv(),
        message,
        baseInteraction,
        0,
        "consumeOp",
        "myMsg",
      ),
    );
    expect(results).toHaveLength(0);
  });

  it("yields message.headers.incompatible when metadata is undefined and schema has required fields", () => {
    const interaction: AsyncInteraction = {
      ...baseInteraction,
      metadata: undefined,
    };
    const results = Array.from(
      compareMessageHeaders(
        makeAjv(),
        baseMessage,
        interaction,
        0,
        "consumeOp",
        "myMsg",
      ),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.headers.incompatible");
    expect(results[0].type).toBe("error");
  });
});
