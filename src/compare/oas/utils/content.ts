import type { SchemaObject } from "ajv";

const PARAMETER_SEPARATOR = ";";
const WILDCARD = "*";
const TYPE_SUBTYPE_SEPARATOR = "/";
const EXTENSION_SEPARATOR = "+";

const quality = (a: string): number => {
  const match = /.*;q=([01].?\d*)/.exec(a);
  return match ? parseFloat(match[1]) : 1.0;
};

const byQuality = (a: string, b: string): number => {
  return quality(b) - quality(a);
};
const ignoreCasing = (t: string): string => t.toLowerCase();
const ignoreWhitespace = (t: string): string => t.replace(/\s+/g, "");
const ignoreParameters = (t: string): string => t.split(PARAMETER_SEPARATOR)[0];
const removeQuality = (t: string): string => t.replace(/;q=[01].?\d*/, "");
const type = (t: string): string => t.split(TYPE_SUBTYPE_SEPARATOR)[0];
const subtype = (t: string): string | undefined => {
  const [_maintype, subtype] = t.split(TYPE_SUBTYPE_SEPARATOR);
  return subtype?.split(EXTENSION_SEPARATOR).pop();
};

export function findMatchingType(
  requestType: string,
  responseTypes: string[],
): string | undefined {
  // exact match
  let accept = requestType
    .split(",")
    .map(ignoreWhitespace)
    .map(ignoreCasing)
    .sort(byQuality)
    .map(removeQuality);
  let available = responseTypes.map(ignoreWhitespace).map(ignoreCasing);
  for (const a of accept) {
    const matchExactly = (t: string): boolean => t === a;
    const index = available.findIndex(matchExactly);
    if (index >= 0) {
      return responseTypes[index];
    }
  }

  // ignore additional parameters
  accept = accept.map(ignoreParameters);
  available = available.map(ignoreParameters);
  for (const a of accept) {
    const matchExactly = (t: string): boolean => t === a;
    const index = available.findIndex(matchExactly);
    if (index >= 0) {
      return responseTypes[index];
    }
  }

  // ignore vendor extensions
  for (const a of accept) {
    const matchTypesAndSubtypes = (t: string): boolean =>
      type(t) === type(a) && subtype(t) === subtype(a);
    const index = available.findIndex(matchTypesAndSubtypes);
    if (index >= 0) {
      return responseTypes[index];
    }
  }

  // wildcards in responseTypes
  for (const a of accept) {
    const matchSubtype = (t: string): boolean =>
      subtype(t) === WILDCARD && type(t) === type(a);
    const index = available.findIndex(matchSubtype);
    if (index >= 0) {
      return responseTypes[index];
    }
  }
  if (available.includes(`${WILDCARD}/${WILDCARD}`)) {
    return `${WILDCARD}/${WILDCARD}`;
  }

  // wildcards in requestTypes
  for (const a of accept) {
    const matchSubtype = (t: string): boolean =>
      subtype(a) === WILDCARD && type(t) === type(a);
    const index = available.findIndex(matchSubtype);
    if (index >= 0) {
      return responseTypes[index];
    }
  }
  if (accept.includes(`${WILDCARD}/${WILDCARD}`)) {
    return responseTypes[0];
  }

  return undefined;
}

export const getByContentType = (
  object = {},
  contentType: string,
): { schema: SchemaObject } => {
  const key = findMatchingType(
    contentType,
    Object.keys(object),
  ) as keyof object;
  return object[key];
};

export const standardHttpRequestHeaders = [
  "accept",
  "accept-charset",
  "accept-datetime",
  "accept-encoding",
  "accept-language",
  "authorization",
  "cache-control",
  "connection",
  "content-length",
  "content-md5",
  "content-type",
  "cookie",
  "date",
  "expect",
  "forwarded",
  "from",
  "host",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "max-forwards",
  "origin",
  "pragma",
  "proxy-authorization",
  "range",
  "referer",
  "te",
  "upgrade",
  "user-agent",
  "via",
  "warning",
];

export const standardHttpResponseHeaders = [
  "access-control-allow-origin",
  "accept-patch",
  "accept-ranges",
  "age",
  "allow",
  "alt-svc",
  "cache-control",
  "connection",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-md5",
  "content-range",
  "date",
  "etag",
  "expires",
  "last-modified",
  "link",
  "location",
  "p3p",
  "pragma",
  "proxy-authenticate",
  "public-key-pins",
  "refresh",
  "retry-after",
  "server",
  "set-cookie",
  "status",
  "strict-transport-security",
  "trailer",
  "transfer-encoding",
  "tsv",
  "upgrade",
  "vary",
  "via",
  "warning",
  "www-authenticate",
  "x-frame-options",
];
