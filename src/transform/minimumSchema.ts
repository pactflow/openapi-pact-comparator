import type { OpenAPIV3 } from "openapi-types";
import { SchemaObject } from "ajv";
import { cloneDeep, get, set } from "lodash-es";
import { traverse } from "./utils";

export const minimumSchema = (
  originalSchema: SchemaObject,
  oas: OpenAPIV3.Document,
): SchemaObject => {
  let schema = originalSchema;

  const refToAdd: string[] = [];
  const refAdded: string[] = [];
  const collectReferences = (s: SchemaObject) => {
    if (s.$ref && !refToAdd.includes(s.$ref) && !refAdded.includes(s.$ref)) {
      refToAdd.push(s.$ref);
    }
  };

  traverse(schema, collectReferences);
  if (refToAdd.length === 0) {
    // no external references, this is the common case for most inlined schemas
    return schema;
  }

  // recursively collect references
  schema = cloneDeep(originalSchema);
  while (refToAdd.length) {
    const ref = refToAdd.shift() as string;
    const path = ref.replace(/\//g, ".").substring(2);
    refAdded.push(ref);

    const subschema = cloneDeep(get(oas, path));
    traverse(subschema, collectReferences);
    set(schema, path, subschema);
  }

  return schema;
};
