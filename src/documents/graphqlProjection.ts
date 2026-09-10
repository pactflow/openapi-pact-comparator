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
  type GraphQLObjectType,
  getNullableType,
  isAbstractType,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
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

/** The concrete object types a selection at `parentType` may resolve to. */
const possibleTypes = (
  parentType: GraphQLNamedType,
  ctx: Context,
): readonly GraphQLObjectType[] => {
  if (isObjectType(parentType)) return [parentType];
  if (isAbstractType(parentType))
    return ctx.schema.getPossibleTypes(parentType);
  return [];
};

/** Whether a fragment's type condition can apply to concrete type `target`. */
const fragmentApplies = (
  conditionName: string | undefined,
  target: GraphQLObjectType,
  ctx: Context,
): boolean => {
  if (!conditionName) return true;
  if (conditionName === target.name) return true;
  const condition = ctx.schema.getType(conditionName);
  if (isInterfaceType(condition)) {
    return target.getInterfaces().some((i) => i.name === condition.name);
  }
  if (isUnionType(condition)) {
    return condition.getTypes().some((t) => t.name === target.name);
  }
  return false;
};

/**
 * Flattens a selection set into the plain field selections that apply when the
 * runtime type is `target`, following inline fragments and named spreads.
 * `seen` guards against fragment cycles — validation rejects them (R9), but the
 * walker must not hang if it is ever called without validation.
 */
const collectFields = (
  selectionSet: SelectionSetNode,
  target: GraphQLObjectType,
  ctx: Context,
  seen: Set<string>,
): FieldNode[] => {
  const fields: FieldNode[] = [];

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      fields.push(selection);
      continue;
    }

    if (selection.kind === Kind.INLINE_FRAGMENT) {
      const condition = selection.typeCondition?.name.value;
      if (!fragmentApplies(condition, target, ctx)) continue;
      fields.push(...collectFields(selection.selectionSet, target, ctx, seen));
      continue;
    }

    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value;
      if (seen.has(name)) continue;
      const fragment = ctx.fragments[name];
      if (!fragment) continue;
      if (!fragmentApplies(fragment.typeCondition.name.value, target, ctx)) {
        continue;
      }
      fields.push(
        ...collectFields(
          fragment.selectionSet,
          target,
          ctx,
          new Set([...seen, name]),
        ),
      );
    }
  }

  return fields;
};

/** Whether any selection below this set narrows by type condition. */
const hasTypeConditions = (
  selectionSet: SelectionSetNode,
  ctx: Context,
  seen: Set<string> = new Set(),
): boolean =>
  selectionSet.selections.some((selection) => {
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      return Boolean(selection.typeCondition);
    }
    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value;
      if (seen.has(name)) return false;
      const fragment = ctx.fragments[name];
      if (!fragment) return false;
      return true;
    }
    return false;
  });

/** Projects the fields that apply to one concrete type. */
const projectConcrete = (
  target: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  path: string,
  ctx: Context,
  typenameValues: string[],
): SchemaObject => {
  const properties: Record<string, SchemaObject | true> = {};
  const required: string[] = [];
  const fields = target.getFields();

  for (const selection of collectFields(selectionSet, target, ctx, new Set())) {
    const key = selection.alias?.value ?? selection.name.value;
    if (key in properties) continue;

    if (selection.name.value === "__typename") {
      properties[key] = { enum: typenameValues };
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

const projectComposite = (
  parentType: GraphQLNamedType,
  selectionSet: SelectionSetNode,
  path: string,
  ctx: Context,
): SchemaObject => {
  const targets = possibleTypes(parentType, ctx);
  if (targets.length === 0) return { type: "object" };

  const allNames = targets.map((t) => t.name);

  // With no type conditions every branch is identical, so emit one object.
  // This keeps the common case readable and produces better AJV errors.
  if (targets.length === 1 || !hasTypeConditions(selectionSet, ctx)) {
    return projectConcrete(
      targets[0],
      selectionSet,
      path,
      ctx,
      isObjectType(parentType) ? [parentType.name] : allNames,
    );
  }

  return {
    anyOf: targets.map((target) =>
      projectConcrete(target, selectionSet, path, ctx, [target.name]),
    ),
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
