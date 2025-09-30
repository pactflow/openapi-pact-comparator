import { describe, expect, it } from "vitest";
import { flattenAllOf } from "./flattenAllOf";

// multiple schemas
const a = { allOf: [{ a: 1 }, { b: 2 }] };
const α = { a: 1, b: 2 };

// multiple nested allOf schemas
const b = {
  allOf: [{ a: 1 }, { allOf: [{ b: 2 }, { c: 3 }] }],
};
const β = { a: 1, b: 2, c: 3 };

// other schemas
const ф = { i: 9 };

describe("#flattenAllOf", () => {
  // prettier-ignore
  it.each([
    // flattens inlined schemas
    [a,                              α],
    [b,                              β],
    [{ properties: { x: a, y: ф } }, { properties: { x: α, y: ф } }],
    [{ properties: { x: b, y: ф } }, { properties: { x: β, y: ф } }],
    [{ oneOf: [a, ф] },              { oneOf: [α, ф] }],
    [{ oneOf: [b, ф] },              { oneOf: [β, ф] }],
    [{ anyOf: [a, ф] },              { anyOf: [α, ф] }],
    [{ anyOf: [b, ф] },              { anyOf: [β, ф] }],
    [{ not: a },                     { not: α }],
    [{ not: b },                     { not: β }],
    [{ items: a },                   { items: α }],
    [{ items: b },                   { items: β }],
    [{ additionalProperties: a },    { additionalProperties: α }],
    [{ additionalProperties: b },    { additionalProperties: β }],

    // dereferences $ref in allOf, else preserves it
    // flattens $ref in referenced schemas
    [
      { $ref: "#/x", x: a },
      { $ref: "#/x", x: α },
      ["#/x"]
    ],
    [
      {
        allOf: [{ a: 1}, { $ref: "#/x"} ], // main schema
        x: ф // references
      },
      {
        a: 1, i: 9, // flattened main schema
        x: ф // references
      },
      ["#/x"],
    ],
    [
      {
        allOf: [{ a: 1}, { allOf: [{ b: 2 }] }, { $ref: "#/x"} ], // main schema
        x: ф // references
      },
      {
        a: 1, b: 2, i: 9, // flattened main schema
        x: ф // references
      },
      ["#/x"],
    ],
    [
      {
        $ref: "#/x", // main schema
        // references
        x: { allOf: [{ $ref: "#/y"}, { a: 1}] },
        y: { b: 2 }
      },
      {
        $ref: "#/x", // main schema
        x: { a: 1, b: 2 }, // flattened reference
        y: { b: 2 } // unmodified reference
      },
      ["#/x", "#/y"]
    ],
  ])("flattenAllOf($0) -> $1", (schema, expected, references = []) => {
    expect(flattenAllOf(schema, references)).toEqual(expected);
  });
});
