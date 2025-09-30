import { SchemaObject } from "ajv";
import { get, merge, set } from "lodash-es";
import { splitPath } from "#utils/schema";

function _flat(s: SchemaObject, root: SchemaObject): SchemaObject {
  if (s.allOf) {
    const { allOf, ...others } = s;
    return merge(
      others,
      ...allOf.map((ss: SchemaObject) => {
        let dereferenced;
        if (ss.$ref) {
          const { $ref, ...others } = ss;
          dereferenced = {
            ...others,
            ...get(root, splitPath($ref)),
          };
        }
        return _flat(dereferenced || ss, root);
      }),
    );
  }

  if (s.properties) {
    for (const ss in s.properties) {
      s.properties[ss] = _flat(s.properties[ss], root);
    }
    return s;
  }

  for (const key of [
    "oneOf",
    "anyOf",
    "not",
    "items",
    "additionalProperties",
  ]) {
    if (s[key]) {
      return {
        ...s,
        [key]: Array.isArray(s[key])
          ? s[key].map((ss: SchemaObject) => _flat(ss, root))
          : _flat(s[key], root),
      };
    }
  }

  return s;
}

// OpenAPI defines allOf to mean the union of all sub-schemas. JSON-Schema
// defines allOf to mean that *every* sub-schema needs to be satisfied.
// To handle the difference, we flatten 'allOf'
export function flattenAllOf(s: SchemaObject, refs: string[]) {
  // main schema
  const flattened = _flat(s, s);

  // any other references
  for (const ref of refs) {
    const path = splitPath(ref);
    set(flattened, path, _flat(get(s, path), s));
  }

  return flattened;
}
