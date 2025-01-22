import { SchemaObject } from "ajv";
import { each } from "lodash-es";

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
