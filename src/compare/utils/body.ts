import { findMatchingType } from "#compare/oas/utils/content";

export type BodyValidationStatus = "validate" | "skip" | "warn";

export const VALIDATABLE_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
] as const;

export const bodyValidationStatus = (
  contentType: string | undefined,
  body: unknown,
  validatableTypes: string[] = [...VALIDATABLE_CONTENT_TYPES],
): BodyValidationStatus => {
  if (typeof contentType !== "string") return "skip";
  if (findMatchingType(contentType, validatableTypes)) return "validate";
  return body !== undefined ? "warn" : "skip";
};
