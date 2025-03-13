const quirks = !!process.env.QUIRKS;

export type Config = Map<
  | "ignoreDuplicateSlashes"
  | "ignoreTrailingSlash"
  | "noTransformNonNullableResponseSchema"
  | "legacyParser"
  | "disableMultipartFormdata"
  | "noValidateRequestBodyUnlessApplicationJson"
  | "noValidateComplexParameters"
  | "castObjectsInPact"
  | "noAuthorizationSchema"
  | "noPercentEncoding",
  boolean
>;

export const defaultConfig: Config = new Map([
  // SMV ignores duplicate slashes in OAS
  ["ignoreDuplicateSlashes", quirks],

  // SMV ignores trailing slashes in OAS
  ["ignoreTrailingSlash", quirks],

  // SMV had a bug whereby nullable response schemas were not transformed
  // correctly. It was missing a transformation to set additionalProperties to
  // false. This flag reproduces the bug.
  ["noTransformNonNullableResponseSchema", quirks],

  // SMV used node:querystring to parse query strings and
  // application/x-www-form-urlencoded form bodies. This had a limitation that
  // nested objects/arrays are not parsed correctly
  ["legacyParser", quirks],

  // SMV didn't support multipart/form-data
  ["disableMultipartFormdata", quirks],

  // SMV had a bug whereby request bodies of *any* content-type are not
  // validated unless application/json is in the list of supported request
  // content types
  ["noValidateRequestBodyUnlessApplicationJson", quirks],

  // SMV only validated schemas of arrays and objects in path, headers, and
  // query params
  ["noValidateComplexParameters", quirks],

  // SMV casts "[object Object]" queries as objects for validation purposes,
  // rather than flag it as a string - suggesting a broken Pact file
  ["castObjectsInPact", quirks],

  // SMV only checks presence of Authorization header, it does not check its schema
  ["noAuthorizationSchema", quirks],

  // SMV allows percentages in path, even if it is not percent encoded
  ["noPercentEncoding", quirks],
]);
