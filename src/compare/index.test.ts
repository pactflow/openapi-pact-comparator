import { describe, expect, it } from "vitest";
import { ParserError } from "#documents/oas";
import { Comparator } from "./index";

describe("Comparator constructor", () => {
  describe("ComparatorOptions input", () => {
    it("accepts an empty options object without throwing", () => {
      expect(() => new Comparator({})).not.toThrow();
    });

    it("accepts options with only an oas key", () => {
      expect(
        () =>
          new Comparator({
            oas: {
              openapi: "3.0.0",
              info: { title: "T", version: "1" },
              paths: {},
            },
          }),
      ).not.toThrow();
    });

    it("throws ParserError when oas value is malformed", () => {
      expect(() => new Comparator({ oas: { paths: {} } as never })).toThrow(
        ParserError,
      );
    });

    it("accepts options with only an asyncapi key (no oas validation)", () => {
      expect(() => new Comparator({ asyncapi: undefined })).not.toThrow();
    });
  });
});
