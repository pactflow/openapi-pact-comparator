import type { SchemaObject } from "ajv";

export const isSimpleSchema = (s?: SchemaObject): boolean =>
  s === undefined || s.type === "array" || s.type === "object";
