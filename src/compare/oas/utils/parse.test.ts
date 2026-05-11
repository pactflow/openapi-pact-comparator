import { beforeAll, describe, expect, it } from "vitest";
import { parseQuery, parseValue } from "./parse";

let parser: (q: string) => unknown;

describe("#parseQuery", () => {
  describe("style=form, explode=true", () => {
    beforeAll(() => {
      parser = parseQuery("form", true);
    });

    it("parses primitive values", () => {
      expect(parser("id=5")).toMatchObject({ id: "5" });
    });

    it("parses array values", () => {
      expect(parser("id=3&id=4&id=5")).toMatchObject({ id: ["3", "4", "5"] });
    });

    it("parses object values", () => {
      expect(parser("role=admin&firstName=Alex")).toMatchObject({
        role: "admin",
        firstName: "Alex",
      });
    });
  });

  describe("style=form, explode=false", () => {
    beforeAll(() => {
      parser = parseQuery("form", false);
    });

    it("parses primitive values", () => {
      expect(parser("id=5")).toMatchObject({ id: "5" });
    });

    it("parses array values", () => {
      expect(parser("id=3,4,5")).toMatchObject({ id: ["3", "4", "5"] });
    });

    it.skip("parses object values", () => {
      expect(parser("id=role,admin,firstName,Alex")).toMatchObject({
        id: {
          role: "admin",
          firstName: "Alex",
        },
      });
    });
  });

  describe("style=spaceDelimited, explode=true", () => {
    beforeAll(() => {
      parser = parseQuery("spaceDelimited", true);
    });

    it("parses array values", () => {
      expect(parser("id=3&id=4&id=5")).toMatchObject({ id: ["3", "4", "5"] });
    });
  });

  describe("style=spaceDelimited, explode false", () => {
    beforeAll(() => {
      parser = parseQuery("spaceDelimited", false);
    });

    it("parses array values", () => {
      expect(parser("id=3%204%205")).toMatchObject({ id: ["3", "4", "5"] });
    });
  });

  describe("style=pipeDelimited, explode=true", () => {
    beforeAll(() => {
      parser = parseQuery("pipeDelimited", true);
    });

    it("parses array values", () => {
      expect(parser("id=3&id=4&id=5")).toMatchObject({ id: ["3", "4", "5"] });
    });
  });

  describe("style=pipeDelimited, explode=false", () => {
    beforeAll(() => {
      parser = parseQuery("pipeDelimited", false);
    });

    it("parses array values", () => {
      expect(parser("id=3|4|5")).toMatchObject({ id: ["3", "4", "5"] });
    });
  });

  describe("style=deepObject, explode=true", () => {
    beforeAll(() => {
      parser = parseQuery("deepObject", true);
    });

    it("parses object values", () => {
      expect(parser("id[role]=admin&id[firstName]=Alex")).toMatchObject({
        id: {
          role: "admin",
          firstName: "Alex",
        },
      });
    });
  });
});

describe("#parseValue", () => {
  it("parses values", () => {
    expect(parseValue(undefined)).toBeUndefined();
    expect(parseValue(null)).toBeNull();
    expect(parseValue("")).toEqual("");
    expect(parseValue("abc")).toEqual("abc");
    expect(parseValue("123")).toEqual("123");
    expect(parseValue("1,2,3")).toEqual(["1", "2", "3"]);
    expect(parseValue("a=a,b=b")).toEqual({ a: "a", b: "b" });
    expect(parseValue("a[x]=a,b[y]=b")).toEqual({
      a: { x: "a" },
      b: { y: "b" },
    });
  });
});
