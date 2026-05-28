import Ajv from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { AsyncAPIDocument, ResolvedMessage } from "#documents/asyncapi";
import { tryMatchAllMessages } from "./matchMessages";

const makeAjv = () => {
  const ajv = new Ajv({ allErrors: true, strictSchema: false });
  addFormats(ajv);
  return ajv;
};

const asyncapi: AsyncAPIDocument = {
  asyncapi: "3.1.0",
  info: { title: "T", version: "1" },
  operations: {},
};

const candidate = (messageId: string, required: boolean): ResolvedMessage => ({
  message: {
    messageId,
    payload: {
      type: "object",
      properties: { id: { type: "string" } },
      ...(required ? { required: ["id"] } : {}),
    },
  },
  path: `[root].components.messages.${messageId}`,
});

const noMatchMockDetails = {
  interactionDescription: "test",
  interactionState: null,
  location: "[root].interactions[0]",
  value: "test",
} as const;

const locations = {
  payload: "[root].interactions[0].contents.content",
  headers: "[root].interactions[0].metadata",
  spec: "[root].operations.op.messages",
};

const interactionContext = { description: "desc" };

describe("tryMatchAllMessages", () => {
  it("yields message.matched info when the single candidate matches", () => {
    const results = [
      ...tryMatchAllMessages(
        makeAjv(),
        asyncapi,
        [candidate("Msg", false)],
        { payload: { id: "abc" }, contentType: "application/json" },
        interactionContext,
        locations,
        "response",
        noMatchMockDetails,
      ),
    ];
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("info");
    expect(results[0].code).toBe("message.matched");
    expect(results[0].specDetails?.location).toBe(
      "[root].components.messages.Msg",
    );
  });

  it("yields message.no.match with causes when the single candidate fails", () => {
    const results = [
      ...tryMatchAllMessages(
        makeAjv(),
        asyncapi,
        [candidate("Msg", true)], // required: true → {} is invalid
        { payload: {}, contentType: "application/json" },
        interactionContext,
        locations,
        "request",
        noMatchMockDetails,
      ),
    ];
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("error");
    expect(results[0].code).toBe("message.no.match");
    expect(results[0].causes).toBeDefined();
    expect(results[0].causes!.length).toBeGreaterThan(0);
    expect(results[0].causes![0].code).toBe("message.payload.incompatible");
  });

  it("stops at the first matching candidate and skips the rest", () => {
    const consumed: string[] = [];
    function* lazyCandidates(): Generator<ResolvedMessage> {
      const msg1 = candidate("First", false);
      consumed.push("First");
      yield msg1;
      const msg2 = candidate("Second", false); // should never be reached
      consumed.push("Second");
      yield msg2;
    }

    const results = [
      ...tryMatchAllMessages(
        makeAjv(),
        asyncapi,
        lazyCandidates(),
        { payload: { id: "abc" }, contentType: "application/json" },
        interactionContext,
        locations,
        "response",
        noMatchMockDetails,
      ),
    ];

    expect(results[0].code).toBe("message.matched");
    expect(consumed).toEqual(["First"]); // Second was never resolved
  });

  it("tries all candidates when first fails and second matches", () => {
    const results = [
      ...tryMatchAllMessages(
        makeAjv(),
        asyncapi,
        [candidate("First", true), candidate("Second", false)], // First requires id, Second doesn't
        { payload: {}, contentType: "application/json" }, // fails First (missing id), passes Second
        interactionContext,
        locations,
        "request",
        noMatchMockDetails,
      ),
    ];
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.matched");
    expect(results[0].specDetails?.location).toBe(
      "[root].components.messages.Second",
    );
  });

  it("yields message.no.match with causes from all candidates when none match", () => {
    const results = [
      ...tryMatchAllMessages(
        makeAjv(),
        asyncapi,
        [candidate("First", true), candidate("Second", true)], // both require id
        { payload: {}, contentType: "application/json" }, // fails both
        interactionContext,
        locations,
        "request",
        noMatchMockDetails,
      ),
    ];
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.no.match");
    expect(results[0].causes!.length).toBeGreaterThanOrEqual(2); // at least one error per candidate
  });

  it("yields message.no.match with empty causes when candidates iterable is empty", () => {
    const results = [
      ...tryMatchAllMessages(
        makeAjv(),
        asyncapi,
        [], // no candidates
        { payload: { id: "abc" }, contentType: "application/json" },
        interactionContext,
        locations,
        "response",
        noMatchMockDetails,
      ),
    ];
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("message.no.match");
    expect(results[0].causes).toEqual([]);
  });
});
