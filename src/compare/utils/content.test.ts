import { describe, expect, it } from "vitest";
import { findMatchingType } from "./content";

describe("#findMatchingType", () => {
  describe("exact matches", () => {
    it("matches none", () => {
      expect(findMatchingType("xxx", ["aaa", "bbb"])).toBe(undefined);
    });

    it("matches one", () => {
      expect(findMatchingType("aaa", ["aaa", "bbb"])).toBe("aaa");
      expect(findMatchingType("bbb", ["aaa", "bbb"])).toBe("bbb");
    });

    it("matches one of many", () => {
      expect(findMatchingType("aaa,xxx", ["aaa", "bbb"])).toBe("aaa");
      expect(findMatchingType("xxx,aaa", ["aaa", "bbb"])).toBe("aaa");
      expect(findMatchingType("bbb,xxx", ["aaa", "bbb"])).toBe("bbb");
      expect(findMatchingType("xxx,bbb", ["aaa", "bbb"])).toBe("bbb");
    });

    it("matches one of many, ignoring whitespaces", () => {
      expect(findMatchingType("aaa, xxx", ["aaa", "bbb"])).toBe("aaa");
      expect(findMatchingType("xxx, aaa", ["aaa", "bbb"])).toBe("aaa");
      expect(findMatchingType("bbb, xxx", ["aaa", "bbb"])).toBe("bbb");
      expect(findMatchingType("xxx, bbb", ["aaa", "bbb"])).toBe("bbb");
    });

    it("matches case-insensitively", () => {
      expect(findMatchingType("AaA", ["aaa", "bbb"])).toBe("aaa");
      expect(findMatchingType("bBb", ["aaa", "bbb"])).toBe("bbb");
    });
  });

  describe("with parameters", () => {
    it("prefers exact matches, but falls back accordingly", () => {
      expect(findMatchingType("aaa;v2", ["aaa", "aaa;v2"])).toBe("aaa;v2");
      expect(findMatchingType("aaa", ["aaa", "aaa;v2"])).toBe("aaa");
      expect(findMatchingType("aaa;v2", ["aaa"])).toBe("aaa");
      expect(findMatchingType("aaa;v3", ["aaa;v1", "aaa;v2"])).toBe("aaa;v1");
    });

    it("prefers exact matches, but falls back accordingly, ignoring whitespaces", () => {
      expect(findMatchingType("aaa; v2", ["aaa", "aaa;v2"])).toBe("aaa;v2");
      expect(findMatchingType("aaa;v2", ["aaa", "aaa; v2"])).toBe("aaa; v2");
      expect(findMatchingType("aaa", ["aaa", "aaa; v2"])).toBe("aaa");
      expect(findMatchingType("aaa; v2", ["aaa"])).toBe("aaa");
    });

    it("matches case-insensitively", () => {
      expect(findMatchingType("aaa;VvV2", ["aaa", "AaA;vvv2"])).toBe(
        "AaA;vvv2",
      );
    });
  });

  describe("extensions", () => {
    it("matches exactly", () => {
      expect(
        findMatchingType("application/vnd.foo+json", [
          "application/json",
          "application/vnd.foo+json",
        ]),
      ).toBe("application/vnd.foo+json");
      expect(
        findMatchingType("application/json", [
          "application/json",
          "application/vnd.foo+json",
        ]),
      ).toBe("application/json");
    });

    it("falls back to base content-type", () => {
      expect(
        findMatchingType("application/vnd.foo+json", ["application/json"]),
      ).toBe("application/json");
    });

    it("uses extended content-type", () => {
      expect(
        findMatchingType("application/json", ["application/vnd.foo+json"]),
      ).toBe("application/vnd.foo+json");
    });
  });

  describe("wildcard responses", () => {
    it("matches wildcard types", () => {
      expect(findMatchingType("aaa", ["aaa/*"])).toBe("aaa/*");
      expect(findMatchingType("aaa", ["aaa;v2"])).toBe("aaa;v2");

      expect(findMatchingType("aaa/*", ["aaa;v2"])).toBe("aaa;v2");
      expect(findMatchingType("aaa/*", ["aaa/bbb"])).toBe("aaa/bbb");
      expect(findMatchingType("aaa/*", ["aaa/bbb;v2"])).toBe("aaa/bbb;v2");
    });
  });

  describe("wildcard requests", () => {
    it("matches wildcard types", () => {
      expect(findMatchingType("aaa/*", ["aaa"])).toBe("aaa");
      expect(findMatchingType("aaa/*", ["aaa;v2"])).toBe("aaa;v2");
      expect(findMatchingType("aaa/*", ["aaa/bbb"])).toBe("aaa/bbb");
      expect(findMatchingType("aaa/*", ["aaa/bbb;v2"])).toBe("aaa/bbb;v2");
    });

    it("matches wildcard types and subtypes", () => {
      expect(findMatchingType("*/*", ["*/*"])).toBe("*/*");
      expect(findMatchingType("*/*", ["aaa", "*/*"])).toBe("*/*");
      expect(findMatchingType("*/*", ["aaa"])).toBe("aaa");
      expect(findMatchingType("*/*", ["aaa/bbb"])).toBe("aaa/bbb");
    });

    // it('impossible scenario', () => {
    //     expect(findMatchingType('*/aaa', [])).toBe('impossible scenario');
    // });
  });

  describe("multiple valid responses", () => {
    it("sorts by q-factor", () => {
      expect(findMatchingType("aaa, bbb;q=0.8", ["aaa", "bbb"])).toBe("aaa");
      expect(findMatchingType("aaa;q=1, bbb;q=0.8", ["aaa", "bbb"])).toBe(
        "aaa",
      );
      expect(findMatchingType("aaa;q=0.8, bbb;q=1.0", ["aaa", "bbb"])).toBe(
        "bbb",
      );
      expect(findMatchingType("aaa;q=0.8, bbb", ["aaa", "bbb"])).toBe("bbb");

      expect(findMatchingType("aaa, aaa;v2;q=0.8", ["aaa", "aaa;v2"])).toBe(
        "aaa",
      );
      expect(findMatchingType("aaa;q=0.8, aaa;v2", ["aaa", "aaa;v2"])).toBe(
        "aaa;v2",
      );
    });
  });
});
