import Ajv from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { Message } from "#documents/asyncapi";
import { compareMessageHeaders } from "./messageHeaders";

const makeAjv = () => {
  const ajv = new Ajv({ allErrors: true, strictSchema: false });
  addFormats(ajv);
  return ajv;
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

const callResponse = (
  message: Message,
  metadata: Record<string, string> | undefined,
  path = "[root].channels.eventsQueue.messages.myMsg",
) =>
  Array.from(
    compareMessageHeaders(
      makeAjv(),
      message,
      { metadata },
      { description: "an event" },
      "[root].interactions[0].metadata",
      path,
      "response",
    ),
  );

describe("compareMessageHeaders", () => {
  it("yields no results when metadata matches schema", () => {
    const results = callResponse(baseMessage, {
      "detail-type": "organization-deleted",
      time: "2024-02-06T18:36:26.102Z",
    });
    expect(results).toHaveLength(0);
  });

  it("yields message.headers.incompatible when metadata fails schema", () => {
    const results = callResponse(baseMessage, {
      "detail-type": 12345 as unknown as string,
    });
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.headers.incompatible");
    expect(results[0].type).toBe("error");
    expect(results[0].mockDetails?.location).toBe(
      "[root].interactions[0].metadata.detail-type",
    );
  });

  it("yields no results when message has no headers schema", () => {
    const message: Message = { messageId: "myMsg" };
    const results = callResponse(message, {
      "detail-type": "organization-deleted",
    });
    expect(results).toHaveLength(0);
  });

  it("yields no results when metadata is undefined (consumer may omit required headers)", () => {
    const results = callResponse(baseMessage, undefined);
    expect(results).toHaveLength(0);
  });

  it("yields message.headers.incompatible when metadata has extra properties not defined in schema", () => {
    const results = callResponse(baseMessage, {
      "detail-type": "organization-deleted",
      time: "2024-02-06T18:36:26.102Z",
      "x-unknown": "extra",
    });
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.headers.incompatible");
    expect(results[0].type).toBe("error");
  });
});

describe("compareMessageHeaders — direction", () => {
  it("enforces required header fields when direction is request", () => {
    const message: Message = {
      messageId: "myMsg",
      headers: {
        type: "object",
        properties: { "correlation-id": { type: "string" } },
        required: ["correlation-id"],
      },
    };
    const results = Array.from(
      compareMessageHeaders(
        makeAjv(),
        message,
        { metadata: {} },
        {},
        "[root].interactions[0].request.metadata",
        "[root].channels.eventsQueue.messages.myMsg",
        "request",
      ),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.headers.incompatible");
  });

  it("does not enforce required header fields when direction is response", () => {
    const message: Message = {
      messageId: "myMsg",
      headers: {
        type: "object",
        properties: { "correlation-id": { type: "string" } },
        required: ["correlation-id"],
      },
    };
    const results = Array.from(
      compareMessageHeaders(
        makeAjv(),
        message,
        { metadata: {} },
        {},
        "[root].interactions[0].metadata",
        "[root].channels.eventsQueue.messages.myMsg",
        "response",
      ),
    );
    expect(results).toHaveLength(0);
  });
});
