import type { SchemaObject } from "ajv";
import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLNamedType,
  type GraphQLOutputType,
  type GraphQLSchema,
  Kind,
  type OperationDefinitionNode,
  type SelectionSetNode,
  getNullableType,
  isEnumType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
} from "graphql";

export interface Projection {
  schema: SchemaObject;
  unvalidatableScalars: string[];
}

export class ProjectionError extends Error {}

interface Context {
  schema: GraphQLSchema;
  fragments: Record<string, FragmentDefinitionNode>;
  unvalidatableScalars: string[];
}

const SCALAR_SCHEMAS: Record<string, SchemaObject> = {
  String: { type: "string" },
  Int: { type: "integer" },
  Float: { type: "number" },
  Boolean: { type: "boolean" },
  ID: { type: ["string", "integer"] },
};

/** Adds "null" to a schema produced for a nullable GraphQL position. */
const nullable = (schema: SchemaObject | true): SchemaObject | true => {
  if (schema === true) return true;
  if (Array.isArray(schema.anyOf)) {
    return { anyOf: [...schema.anyOf, { type: "null" }] };
  }
  if (Array.isArray(schema.enum)) {
    return { ...schema, enum: [...schema.enum, null] };
  }
  const type = schema.type;
  if (Array.isArray(type)) return { ...schema, type: [...type, "null"] };
  if (typeof type === "string") return { ...schema, type: [type, "null"] };
  return schema;
};

const isConditional = (field: FieldNode): boolean =>
  (field.directives ?? []).some(
    (d) => d.name.value === "skip" || d.name.value === "include",
  );

const rootTypeFor = (
  schema: GraphQLSchema,
  operation: OperationDefinitionNode,
): GraphQLNamedType => {
  const root =
    operation.operation === "query"
      ? schema.getQueryType()
      : operation.operation === "mutation"
        ? schema.getMutationType()
        : schema.getSubscriptionType();

  if (!root) {
    throw new ProjectionError(
      `Schema defines no ${operation.operation} root type`,
    );
  }
  return root;
};

export const selectOperation = (
  document: DocumentNode,
  operationName?: string,
): OperationDefinitionNode => {
  const operations = document.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );

  if (operations.length === 0) {
    throw new ProjectionError("Document contains no GraphQL operation");
  }

  if (operationName) {
    const match = operations.find((o) => o.name?.value === operationName);
    if (!match) {
      throw new ProjectionError(
        `Document contains no operation named "${operationName}"`,
      );
    }
    return match;
  }

  if (operations.length > 1) {
    throw new ProjectionError(
      "Document contains multiple operations but no operationName was given",
    );
  }

  return operations[0];
};

const projectType = (
  type: GraphQLOutputType,
  selectionSet: SelectionSetNode | undefined,
  path: string,
  ctx: Context,
): SchemaObject | true => {
  const isRequired = isNonNullType(type);
  const inner = getNullableType(type);

  let schema: SchemaObject | true;

  if (isListType(inner)) {
    const items = projectType(inner.ofType, selectionSet, path, ctx);
    schema = { type: "array", items };
  } else if (isScalarType(inner)) {
    const known = SCALAR_SCHEMAS[inner.name];
    if (known) {
      schema = { ...known };
    } else {
      ctx.unvalidatableScalars.push(path);
      schema = true;
    }
  } else if (isEnumType(inner)) {
    schema = { enum: inner.getValues().map((v) => v.name) };
  } else if (selectionSet) {
    schema = projectComposite(inner, selectionSet, path, ctx);
  } else {
    schema = true;
  }

  return isRequired ? schema : nullable(schema);
};

/**
 * Object types only. Task 4 replaces this with a version that also handles
 * interfaces and unions via fragment collection.
 */
const projectComposite = (
  parentType: GraphQLNamedType,
  selectionSet: SelectionSetNode,
  path: string,
  ctx: Context,
): SchemaObject => {
  const properties: Record<string, SchemaObject | true> = {};
  const required: string[] = [];

  if (!isObjectType(parentType)) {
    // Abstract types arrive in Task 4; until then accept any object shape
    // rather than emit a schema that would wrongly reject valid responses.
    return { type: "object" };
  }

  const fields = parentType.getFields();

  for (const selection of selectionSet.selections) {
    if (selection.kind !== Kind.FIELD) continue;

    const key = selection.alias?.value ?? selection.name.value;

    if (selection.name.value === "__typename") {
      properties[key] = { type: "string" };
      if (!isConditional(selection)) required.push(key);
      continue;
    }

    const fieldDef = fields[selection.name.value];
    // An unknown field is R4, already reported by validation; skip it here
    // so the projection never invents constraints from a broken document.
    if (!fieldDef) continue;

    properties[key] = projectType(
      fieldDef.type,
      selection.selectionSet,
      `${path}.${key}`,
      ctx,
    );
    if (!isConditional(selection)) required.push(key);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
};

export const projectOperation = (
  schema: GraphQLSchema,
  document: DocumentNode,
  operationName?: string,
): Projection => {
  const operation = selectOperation(document, operationName);
  const ctx: Context = {
    schema,
    fragments: Object.fromEntries(
      document.definitions
        .filter(
          (d): d is FragmentDefinitionNode =>
            d.kind === Kind.FRAGMENT_DEFINITION,
        )
        .map((d) => [d.name.value, d]),
    ),
    unvalidatableScalars: [],
  };

  const root = rootTypeFor(schema, operation);
  const data = projectComposite(root, operation.selectionSet, "data", ctx);

  return {
    schema: {
      type: "object",
      properties: {
        data: nullable(data),
        errors: true,
        extensions: true,
      },
      additionalProperties: false,
    },
    unvalidatableScalars: ctx.unvalidatableScalars,
  };
};
