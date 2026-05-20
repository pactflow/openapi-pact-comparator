import type { SchemaObject } from "ajv";
import { each, get } from "lodash-es";
import type { OpenAPIV3 } from "openapi-types";

export const resolveSchemaRefs = (
  schema: unknown,
  doc: object,
  visited: Set<string> = new Set(),
): unknown => {
  if (schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) => resolveSchemaRefs(item, doc, visited));
  }
  const obj = schema as Record<string, unknown>;
  if (typeof obj.$ref === "string") {
    const ref = obj.$ref;
    if (visited.has(ref)) return {};
    return resolveSchemaRefs(
      get(doc, splitPath(ref)),
      doc,
      new Set([...visited, ref]),
    );
  }
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      resolveSchemaRefs(v, doc, visited),
    ]),
  );
};

const unescape = (subpath: string) =>
  decodeURI(subpath.replaceAll("~1", "/").replaceAll("~0", "~"));

export const splitPath = (path: string) => {
  if (path.startsWith("#/")) {
    return path.substring(2).split("/").map(unescape);
  }

  if (path.startsWith("/")) {
    return path.substring(1).split("/").map(unescape);
  }

  return path;
};

export const dereferenceOas = (
  schema: SchemaObject,
  oas: OpenAPIV3.Document,
) => (schema.$ref ? get(oas, splitPath(schema.$ref)) : schema);

export const dereferenceDoc = (
  schema: { $ref?: string },
  doc: object,
): unknown =>
  schema.$ref ? get(doc, splitPath(schema.$ref as string)) : schema;

export const traverse = (
  schema: SchemaObject,
  visitor: (schema: SchemaObject) => void,
) => {
  if (typeof schema === "boolean" || schema === undefined) {
    return;
  }

  const traverseSubSchema = (item: SchemaObject) => traverse(item, visitor);

  each(schema.allOf, traverseSubSchema);
  each(schema.oneOf, traverseSubSchema);
  each(schema.anyOf, traverseSubSchema);
  each(schema.properties, traverseSubSchema);
  traverseSubSchema(schema.not);
  traverseSubSchema(schema.items);
  traverseSubSchema(schema.additionalProperties);

  visitor(schema);
};

const _traverseWithDereferencing = (
  schema: SchemaObject,
  oas: OpenAPIV3.Document,
  visited: string[],
  visitor: (schema: SchemaObject) => void,
) => {
  if (typeof schema === "boolean" || schema === undefined) {
    return;
  }

  if (visited.includes(schema.$ref)) {
    return;
  }

  if (schema.$ref) {
    visited.push(schema.$ref);
  }
  const dereferencedSchema = dereferenceOas(schema, oas);

  if (schema.nullable) {
    dereferencedSchema.nullable = schema.nullable;
    if (!dereferencedSchema.type) {
      dereferencedSchema.type = "object";
    }
  }

  const traverseSubSchema = (item: SchemaObject) =>
    _traverseWithDereferencing(item, oas, visited, visitor);

  each(dereferencedSchema.allOf, traverseSubSchema);
  each(dereferencedSchema.oneOf, traverseSubSchema);
  each(dereferencedSchema.anyOf, traverseSubSchema);
  each(dereferencedSchema.properties, traverseSubSchema);
  traverseSubSchema(dereferencedSchema.not);
  traverseSubSchema(dereferencedSchema.items);
  traverseSubSchema(dereferencedSchema.additionalProperties);

  visitor(dereferencedSchema);
};

export const traverseWithDereferencing = (
  schema: SchemaObject,
  visitor: (schema: SchemaObject) => void,
) => {
  _traverseWithDereferencing(schema, schema as OpenAPIV3.Document, [], visitor);
};
