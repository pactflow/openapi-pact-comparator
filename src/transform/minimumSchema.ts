import type { OpenAPIV3 } from "openapi-types";
import { SchemaObject } from "ajv";
import { cloneDeep, get, set } from "lodash-es";
import { splitPath, traverse } from "../utils/schema";

const convertNullableToTypeNull = (s: SchemaObject) => {
  if (s.nullable && !Array.isArray(s.type)) {
    s.type = [s.type, "null"];
  }
};

export const minimumSchema = (
  originalSchema: SchemaObject,
  oas: OpenAPIV3.Document,
): SchemaObject => {
  const refToAdd: string[] = [];
  const refAdded: string[] = [];
  const collectReferences = (s: SchemaObject) => {
    if (s.$ref && !refToAdd.includes(s.$ref) && !refAdded.includes(s.$ref)) {
      refToAdd.push(s.$ref);
    }
  };

  const schema = cloneDeep(originalSchema);
  delete schema.description;
  delete schema.example;
  traverse(schema, collectReferences);
  traverse(schema, convertNullableToTypeNull);

  while (refToAdd.length) {
    const ref = refToAdd.shift() as string;
    const path = splitPath(ref);
    refAdded.push(ref);

    const subschema = cloneDeep(get(oas, path));
    delete subschema.description;
    delete subschema.example;
    traverse(subschema, collectReferences);
    traverse(subschema, convertNullableToTypeNull);

    set(schema, path, subschema);
  }

  return schema;
};
