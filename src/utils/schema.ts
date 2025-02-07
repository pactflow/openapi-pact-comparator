import type { OpenAPIV3 } from "openapi-types";
import type { SchemaObject } from "ajv";
import { each, get } from "lodash-es";

export const splitPath = (path: string) => {
  if (path.startsWith("#/")) {
    return path.substring(2).split("/");
  }

  if (path.startsWith("/")) {
    return path.substring(1).split("/");
  }

  return path;
};

export const dereferenceOas = (
  schema: SchemaObject,
  oas: OpenAPIV3.Document,
) => (schema.$ref ? get(oas, splitPath(schema.$ref)) : schema);

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
  visitor: (schema: SchemaObject) => void,
) => {
  if (typeof schema === "boolean" || schema === undefined) {
    return;
  }

  const dereferencedSchema = dereferenceOas(schema, oas);

  const traverseSubSchema = (item: SchemaObject) =>
    _traverseWithDereferencing(item, oas, visitor);

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
  _traverseWithDereferencing(schema, schema as OpenAPIV3.Document, visitor);
};
