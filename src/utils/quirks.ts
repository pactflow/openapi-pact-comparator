import type { SchemaObject } from "ajv";

export const isQuirky = (s?: SchemaObject): boolean =>
  s === undefined || s.type === "array" || s.type === "object";
