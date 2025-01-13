import { SchemaObject } from "ajv";
import { each } from "lodash-es";

export const traverse = (
  schema: SchemaObject,
  visitor: (schema: SchemaObject) => void,
  includeReferences = true,
) => {
  if (typeof schema === "boolean" || schema === undefined) {
    return;
  }

  const traverseSubSchema = (item: SchemaObject) => traverse(item, visitor);

  if (includeReferences) {
    each(schema.components?.schemas, traverseSubSchema);
    each(schema.definitions, traverseSubSchema);
  }

  each(schema.allOf, traverseSubSchema);
  each(schema.oneOf, traverseSubSchema);
  each(schema.anyOf, traverseSubSchema);
  each(schema.properties, traverseSubSchema);
  traverseSubSchema(schema.not);
  traverseSubSchema(schema.items);
  traverseSubSchema(schema.additionalProperties);

  visitor(schema);
};
