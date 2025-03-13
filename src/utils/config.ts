const quirks = !!process.env.QUIRKS;

export type Config = Map<
  | "cast-objects-in-pact"
  | "disable-multipart-formdata"
  | "ignore-duplicate-slashes"
  | "ignore-trailing-slash"
  | "legacy-parser"
  | "no-authorization-schema"
  | "no-percent-encoding"
  | "no-transform-non-nullable-response-schema"
  | "no-validate-complex-parameters"
  | "no-validate-request-body-unless-application-json",
  boolean
>;

export const DEFAULT_CONFIG: Config = new Map([
  // SMV casts "[object Object]" queries as objects for validation purposes,
  // rather than flag it as a string - suggesting a broken Pact file
  ["cast-objects-in-pact", quirks],

  // SMV didn't support multipart/form-data
  ["disable-multipart-formdata", quirks],

  // SMV ignores duplicate slashes in OAS
  ["ignore-duplicate-slashes", quirks],

  // SMV ignores trailing slashes in OAS
  ["ignore-trailing-slash", quirks],

  // SMV used node:querystring to parse query strings and
  // application/x-www-form-urlencoded form bodies. This had a limitation that
  // nested objects/arrays are not parsed correctly
  ["legacy-parser", quirks],

  // SMV only checks presence of Authorization header, it does not check its schema
  ["no-authorization-schema", quirks],

  // SMV allows percentages in path, even if it is not percent encoded
  ["no-percent-encoding", quirks],

  // SMV had a bug whereby nullable response schemas were not transformed
  // correctly. It was missing a transformation to set additionalProperties to
  // false. This flag reproduces the bug.
  ["no-transform-non-nullable-response-schema", quirks],

  // SMV only validated schemas of arrays and objects in path, headers, and
  // query params
  ["no-validate-complex-parameters", quirks],

  // SMV had a bug whereby request bodies of *any* content-type are not
  // validated unless application/json is in the list of supported request
  // content types
  ["no-validate-request-body-unless-application-json", quirks],
]);
