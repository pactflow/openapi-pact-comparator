import { describe, expect, it } from "vitest";
import Ajv from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { compareMessagePayload } from "./messagePayload";
import type { AsyncInteraction } from "#documents/pact";
import type { Message } from "#documents/asyncapi";

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
  metadata: {},
};

const baseMessage: Message = {
  messageId: "myMsg",
  payload: {
    type: "object",
    properties: { organizationId: { type: "string" } },
    required: ["organizationId"],
  },
};

describe("compareMessagePayload", () => {
  it("yields no results when payload matches schema", () => {
    const results = Array.from(
      compareMessagePayload(makeAjv(), baseMessage, baseInteraction, 0, "consumeOp", "myMsg"),
    );
    expect(results).toHaveLength(0);
  });

  it("yields message.payload.incompatible when payload fails schema", () => {
    const interaction: AsyncInteraction = {
      ...baseInteraction,
      payload: { organizationId: 12345 },
    };
    const results = Array.from(
      compareMessagePayload(makeAjv(), baseMessage, interaction, 0, "consumeOp", "myMsg"),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.payload.incompatible");
    expect(results[0].type).toBe("error");
    expect(results[0].mockDetails?.location).toBe(
      "[root].interactions[0].contents.organizationId",
    );
  });

  it("yields message.payload.unknown warning when no schema defined", () => {
    const message: Message = { messageId: "myMsg" }; // no payload schema
    const results = Array.from(
      compareMessagePayload(makeAjv(), message, baseInteraction, 0, "consumeOp", "myMsg"),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.payload.unknown");
    expect(results[0].type).toBe("warning");
  });

  it("skips validation when payload is undefined and no schema", () => {
    const message: Message = { messageId: "myMsg" };
    const interaction: AsyncInteraction = { ...baseInteraction, payload: undefined };
    const results = Array.from(
      compareMessagePayload(makeAjv(), message, interaction, 0, "consumeOp", "myMsg"),
    );
    expect(results).toHaveLength(0);
  });

  it("skips validation for non-JSON content types", () => {
    const interaction: AsyncInteraction = {
      ...baseInteraction,
      contentType: "application/avro",
    };
    const results = Array.from(
      compareMessagePayload(makeAjv(), baseMessage, interaction, 0, "consumeOp", "myMsg"),
    );
    expect(results).toHaveLength(0);
  });

  it("skips validation when contentType is not a string", () => {
    const interaction = {
      ...baseInteraction,
      contentType: 42 as unknown as string,
    };
    expect(() =>
      Array.from(
        compareMessagePayload(makeAjv(), baseMessage, interaction, 0, "consumeOp", "myMsg"),
      ),
    ).not.toThrow();
    const results = Array.from(
      compareMessagePayload(makeAjv(), baseMessage, interaction, 0, "consumeOp", "myMsg"),
    );
    expect(results).toHaveLength(0);
  });

  it("validates JSON content types with +json suffix", () => {
    const interaction: AsyncInteraction = {
      ...baseInteraction,
      contentType: "application/cloudevents+json; charset=utf-8",
    };
    const results = Array.from(
      compareMessagePayload(makeAjv(), baseMessage, interaction, 0, "consumeOp", "myMsg"),
    );
    expect(results).toHaveLength(0);
  });
});
