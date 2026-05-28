import Ajv from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { Message } from "#documents/asyncapi";
import { compareMessagePayload } from "./messagePayload";

const makeAjv = () => {
  const ajv = new Ajv({ allErrors: true, strictSchema: false });
  addFormats(ajv);
  return ajv;
};

const baseMessage: Message = {
  payload: {
    type: "object",
    properties: { organizationId: { type: "string" } },
    required: ["organizationId"],
  },
};

// Helper to call with response direction for backward-compatible tests
const callResponse = (
  message: Message,
  payload: unknown,
  contentType: string | undefined,
  path = "[root].channels.eventsQueue.messages.myMsg",
) =>
  Array.from(
    compareMessagePayload(
      makeAjv(),
      message,
      { payload, contentType },
      { description: "an event" },
      "[root].interactions[0].contents.content",
      path,
      "response",
    ),
  );

describe("compareMessagePayload", () => {
  it("yields no results when payload matches schema", () => {
    const results = callResponse(
      baseMessage,
      { organizationId: "abc-123" },
      "application/json",
      "[root].channels.eventsQueue.messages.myMsg",
    );
    expect(results).toHaveLength(0);
  });

  it("yields message.payload.incompatible when payload fails schema", () => {
    const results = callResponse(
      baseMessage,
      { organizationId: 12345 },
      "application/json",
      "[root].channels.eventsQueue.messages.myMsg",
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.payload.incompatible");
    expect(results[0].type).toBe("error");
    expect(results[0].mockDetails?.location).toBe(
      "[root].interactions[0].contents.content.organizationId",
    );
  });

  it("yields message.payload.unknown warning when no schema defined", () => {
    const message: Message = {};
    const results = callResponse(
      message,
      { organizationId: "abc-123" },
      "application/json",
      "[root].channels.eventsQueue.messages.myMsg",
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.payload.unknown");
    expect(results[0].type).toBe("warning");
  });

  it("skips validation when payload is undefined and no schema", () => {
    const message: Message = {};
    const results = callResponse(
      message,
      undefined,
      "application/json",
      "[root].channels.eventsQueue.messages.myMsg",
    );
    expect(results).toHaveLength(0);
  });

  it("skips validation for non-JSON content types", () => {
    const results = callResponse(
      baseMessage,
      { organizationId: "abc-123" },
      "application/avro",
      "[root].channels.eventsQueue.messages.myMsg",
    );
    expect(results).toHaveLength(0);
  });

  it("skips validation when contentType is not a string", () => {
    expect(() =>
      Array.from(
        compareMessagePayload(
          makeAjv(),
          baseMessage,
          { payload: { organizationId: "abc-123" }, contentType: 42 as unknown as string },
          { description: "an event" },
          "[root].interactions[0].contents.content",
          "[root].channels.eventsQueue.messages.myMsg",
          "response",
        ),
      ),
    ).not.toThrow();
    const results = Array.from(
      compareMessagePayload(
        makeAjv(),
        baseMessage,
        { payload: { organizationId: "abc-123" }, contentType: 42 as unknown as string },
        { description: "an event" },
        "[root].interactions[0].contents.content",
        "[root].channels.eventsQueue.messages.myMsg",
        "response",
      ),
    );
    expect(results).toHaveLength(0);
  });

  it("validates JSON content types with +json suffix", () => {
    const results = callResponse(
      baseMessage,
      { organizationId: "abc-123" },
      "application/cloudevents+json; charset=utf-8",
      "[root].channels.eventsQueue.messages.myMsg",
    );
    expect(results).toHaveLength(0);
  });

  it("yields message.payload.incompatible when payload has extra properties not defined in schema", () => {
    const results = callResponse(
      baseMessage,
      { organizationId: "abc-123", unknownField: "extra" },
      "application/json",
      "[root].channels.eventsQueue.messages.myMsg",
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.payload.incompatible");
    expect(results[0].type).toBe("error");
  });
});

describe("compareMessagePayload — direction", () => {
  it("enforces required fields when direction is request", () => {
    // payload is missing required "organizationId"
    const results = Array.from(
      compareMessagePayload(
        makeAjv(),
        baseMessage,
        { payload: {}, contentType: "application/json" },
        {},
        "[root].interactions[0].request.contents.content",
        "[root].channels.eventsQueue.messages.myMsg",
        "request",
      ),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.payload.incompatible");
  });

  it("does not enforce required fields when direction is response", () => {
    // same missing field, but consumer only asserts what it needs
    const results = Array.from(
      compareMessagePayload(
        makeAjv(),
        baseMessage,
        { payload: {}, contentType: "application/json" },
        {},
        "[root].interactions[0].contents.content",
        "[root].channels.eventsQueue.messages.myMsg",
        "response",
      ),
    );
    expect(results).toHaveLength(0);
  });

  it("allows extra properties when spec has no additionalProperties restriction and direction is request", () => {
    const results = Array.from(
      compareMessagePayload(
        makeAjv(),
        baseMessage,
        { payload: { organizationId: "abc", extra: "field" }, contentType: "application/json" },
        {},
        "[root].interactions[0].request.contents.content",
        "[root].channels.eventsQueue.messages.myMsg",
        "request",
      ),
    );
    expect(results).toHaveLength(0);
  });

  it("errors on extra properties when spec has additionalProperties: false and direction is request", () => {
    const strictMessage: Message = {
      payload: {
        type: "object",
        properties: { organizationId: { type: "string" } },
        required: ["organizationId"],
        additionalProperties: false,
      },
    };
    const results = Array.from(
      compareMessagePayload(
        makeAjv(),
        strictMessage,
        { payload: { organizationId: "abc", extra: "field" }, contentType: "application/json" },
        {},
        "[root].interactions[0].request.contents.content",
        "[root].channels.eventsQueue.messages.myMsg",
        "request",
      ),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.payload.incompatible");
  });
});
