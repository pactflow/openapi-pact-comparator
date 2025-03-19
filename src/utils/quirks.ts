import type { OpenAPIV3 } from "openapi-types";
import type { SchemaObject } from "ajv";
import { dereferenceOas } from "#utils/schema";

export const isSimpleSchema = (
  s: SchemaObject | undefined,
  oas: OpenAPIV3.Document,
): boolean => {
  if (s === undefined) {
    return true;
  }

  const dereferencedSchema = dereferenceOas(s, oas);
  return (
    dereferencedSchema.type === "array" || dereferencedSchema.type === "object"
  );
};
