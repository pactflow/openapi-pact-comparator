import type { DocumentNode, GraphQLSchema } from "graphql";
import type { Projection } from "#documents/graphqlProjection";
import { projectOperation } from "#documents/graphqlProjection";
import { stripRequired } from "./responseSchema";

/**
 * The projection with its `required` constraints removed, which is the
 * response-side subset rule: a consumer may omit any field it selected (P7),
 * including one the provider declares non-null (P8). `additionalProperties`
 * stays false throughout, so a field the consumer never selected — or one that
 * does not exist — is still rejected (P1).
 */
export const graphqlResponseSchema = (
  schema: GraphQLSchema,
  document: DocumentNode,
  operationName?: string,
): Projection => {
  const projection = projectOperation(schema, document, operationName);
  stripRequired(projection.schema);
  return projection;
};
