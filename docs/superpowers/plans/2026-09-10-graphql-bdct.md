# GraphQL BDCT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare a GraphQL provider contract (SDL) against a consumer Pact file, so PactFlow's bi-directional contract testing supports GraphQL alongside OpenAPI and AsyncAPI.

**Architecture:** A GraphQL interaction is an ordinary V4 `Synchronous/HTTP` Pact interaction, so it is reclassified out of `http` during pact parsing into a new `graphql-http` kind (and `graphql-message` for subscriptions). The request-side subset check delegates to `graphql.validate()` — the GraphQL specification's own validation rules are exactly the subset rule. The response-side check *projects* the operation's selection set through the provider schema into a JSON Schema, then reuses this repo's existing AJV pipeline and `stripRequired` transform to allow the consumer to omit fields it did not assert on.

**Tech Stack:** TypeScript (ESM, Node ≥22), `graphql` (graphql-js) for parsing/validation/type system, AJV 2019 for response comparison, Vitest with `toMatchFileSnapshot` fixtures, rollup for bundling.

**Spec:**
- `docs/superpowers/specs/2026-09-10-graphql-bdct-requirements.md` (normative business rules — rule IDs R1–R10, P1–P8, U1–U4, S1–S3 are cited throughout this plan)
- `docs/superpowers/specs/2026-09-10-graphql-bdct-design.md` (architecture)

Read both before starting. Tasks cite rule IDs rather than restating the rules.

## Global Constraints

- Node `>=22`. ESM (`"type": "module"`). TypeScript strict — `npm run typecheck` must pass.
- `package.json` declares **no `dependencies`** — everything is a devDependency and rollup bundles it. `graphql` follows that existing convention (see Task 1).
- Subpath imports must use the existing `imports` map: `#compare/*`, `#documents/*`, `#results/*`, `#transform/*`, `#utils/*`. Do not add relative cross-directory imports.
- Lint must pass with zero warnings: `npm run lint` (`eslint --max-warnings=0`). Format with `npm run prettier:fix`.
- Result objects must conform to the existing `Result` interface in `src/results/index.ts`. Every new `code` string must be added to the `ErrorCode` / `WarningCode` / `InfoCode` unions or TypeScript will reject it.
- Never fail a comparison on schema provenance (S3). Provenance produces `warning` and `info` results only.
- Consumer `matchingRules` are ignored entirely — do not read them.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).

---

### Task 1: Add the `graphql` dependency and prove it survives bundling

The design flags this as the top risk: graphql-js has dual ESM/CJS packaging that produces `instanceof` failures ("Cannot use GraphQLSchema from another module") in bundled output that source-run unit tests never catch. Prove the bundle works before writing any feature code.

**Files:**
- Modify: `package.json` (devDependencies)
- Create: `src/documents/graphql.ts`
- Create: `scripts/smoke-graphql-bundle.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `parse(sdl: string): GraphQLSchema` and `ParserError` from `#documents/graphql`

- [ ] **Step 1: Install the dependency**

```bash
npm install --save-dev graphql@16.11.0
```

- [ ] **Step 2: Write the failing test**

Create `src/documents/graphql.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ParserError, parse } from "./graphql";

const SDL = `
type Query { product(id: ID!): Product }
type Product { id: ID!, name: String! }
`;

describe("parse", () => {
  it("builds a schema from valid SDL", () => {
    const schema = parse(SDL);
    expect(schema.getQueryType()?.name).toBe("Query");
  });

  it("throws ParserError on a syntax error", () => {
    expect(() => parse("type Query {")).toThrow(ParserError);
  });

  it("throws ParserError when the schema is invalid", () => {
    // Missing Query root type is a schema validation error, not a syntax error
    expect(() => parse("type Product { id: ID! }")).toThrow(ParserError);
  });

  it("exposes the underlying GraphQL errors", () => {
    try {
      parse("type Query {");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ParserError).errors.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/documents/graphql.test.ts`
Expected: FAIL — cannot resolve `./graphql`.

- [ ] **Step 4: Write the minimal implementation**

Create `src/documents/graphql.ts`:

```ts
import { GraphQLError, type GraphQLSchema, buildSchema, validateSchema } from "graphql";

export class ParserError extends Error {
  errors: readonly GraphQLError[];

  constructor(errors: readonly GraphQLError[]) {
    super("Malformed GraphQL schema");
    this.errors = errors;
  }
}

export const parse = (sdl: string): GraphQLSchema => {
  let schema: GraphQLSchema;
  try {
    schema = buildSchema(sdl, { assumeValidSDL: false });
  } catch (e) {
    throw new ParserError([
      e instanceof GraphQLError ? e : new GraphQLError(String(e)),
    ]);
  }

  const errors = validateSchema(schema);
  if (errors.length) {
    throw new ParserError(errors);
  }

  return schema;
};
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/documents/graphql.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Export from the package entry point so the bundle includes it**

Modify `src/index.ts` — append:

```ts
export { parse as parseGraphqlSchema } from "./documents/graphql";
```

- [ ] **Step 7: Write the bundle smoke test**

Create `scripts/smoke-graphql-bundle.mjs`:

```js
// Verifies graphql-js survives rollup bundling in BOTH output formats.
// The dual ESM/CJS packaging of graphql-js causes `instanceof` checks to fail
// across module realms; that only shows up in built output, never in src.
import { createRequire } from "node:module";

const SDL = `type Query { product(id: ID!): Product }
type Product { id: ID!, name: String! }`;

const check = (label, parseGraphqlSchema) => {
  const schema = parseGraphqlSchema(SDL);
  const queryType = schema.getQueryType();
  if (!queryType || queryType.name !== "Query") {
    throw new Error(`${label}: expected a Query root type, got ${queryType?.name}`);
  }
  console.log(`${label}: ok`);
};

const require = createRequire(import.meta.url);
check("dist/index.cjs", require("../dist/index.cjs").parseGraphqlSchema);
check("dist/index.mjs", (await import("../dist/index.mjs")).parseGraphqlSchema);
console.log("graphql bundle smoke test passed");
```

- [ ] **Step 8: Add the script and run it against a real build**

Modify `package.json` scripts — add:

```json
"smoke:graphql": "npm run build && node scripts/smoke-graphql-bundle.mjs"
```

Run: `npm run smoke:graphql`
Expected: `dist/index.cjs: ok`, `dist/index.mjs: ok`, `graphql bundle smoke test passed`.

**If this fails**, stop and resolve it before continuing — that is the entire point of this task. The usual fixes, in order of preference: add `graphql` to `rollup.config.js` `external` so it is required at runtime rather than inlined (and move it to a real `dependencies` entry); or set `output.interop` appropriately for the CJS build. Record whichever fix was needed in the commit message, because it changes the packaging story described in the design.

- [ ] **Step 9: Verify the rest of the suite and types still pass**

Run: `npm test -- --run && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/documents/graphql.ts src/documents/graphql.test.ts src/index.ts scripts/smoke-graphql-bundle.mjs
git commit -m "feat: add graphql dependency with SDL parsing and bundle smoke test"
```

---

### Task 2: Schema fingerprinting for provenance

S1 compares the consumer's embedded schema against the provider contract. Hashing raw SDL text is fragile — whitespace and field ordering differ between a schema printed by a server and one stored in git. Hash the *normalised* printed schema instead.

**Files:**
- Modify: `src/documents/graphql.ts`
- Modify: `src/documents/graphql.test.ts`

**Interfaces:**
- Consumes: `parse` from Task 1
- Produces: `fingerprint(sdl: string): string`, `looksLikeGraphqlDocument(source: string): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `src/documents/graphql.test.ts`:

```ts
import { fingerprint, looksLikeGraphqlDocument } from "./graphql";

describe("fingerprint", () => {
  it("is stable across formatting differences", () => {
    const a = "type Query { product(id: ID!): Product }\ntype Product { id: ID! }";
    const b = "type   Product {\n  id: ID!\n}\n\ntype Query {\n  product(id: ID!): Product\n}\n";
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("differs when the schema differs", () => {
    const a = "type Query { product(id: ID!): Product }\ntype Product { id: ID! }";
    const b = "type Query { product(id: ID!): Product }\ntype Product { id: ID!, name: String }";
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("returns undefined for unparseable SDL rather than throwing", () => {
    expect(fingerprint("type Query {")).toBeUndefined();
  });
});

describe("looksLikeGraphqlDocument", () => {
  it("accepts a query document", () => {
    expect(looksLikeGraphqlDocument("query Q($id: ID!) { product(id: $id) { id } }")).toBe(true);
  });

  it("rejects a SQL-ish string", () => {
    expect(looksLikeGraphqlDocument("SELECT * FROM products WHERE id = 1")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(looksLikeGraphqlDocument("")).toBe(false);
  });

  it("rejects a document containing no executable operation", () => {
    expect(looksLikeGraphqlDocument("type Query { a: String }")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/documents/graphql.test.ts`
Expected: FAIL — `fingerprint` and `looksLikeGraphqlDocument` are not exported.

- [ ] **Step 3: Implement**

Append to `src/documents/graphql.ts`:

```ts
import { createHash } from "node:crypto";
import { Kind, parse as parseDocument, printSchema } from "graphql";

/**
 * A stable fingerprint of a schema's *meaning*, not its text. Normalising
 * through printSchema() means whitespace and declaration order do not produce
 * a spurious provenance mismatch (S1).
 *
 * Returns undefined when the SDL cannot be parsed — a consumer's embedded
 * schema is diagnostic input only and must never break a comparison (S3).
 */
export const fingerprint = (sdl: string): string | undefined => {
  try {
    return createHash("sha256")
      .update(printSchema(parse(sdl)), "utf-8")
      .digest("hex");
  } catch {
    return undefined;
  }
};

/**
 * Whether a string parses as a GraphQL document containing at least one
 * executable operation. Used as the strong guard on heuristic classification
 * of non-plugin GraphQL pacts (requirements section 4, condition 3).
 */
export const looksLikeGraphqlDocument = (source: string): boolean => {
  if (!source.trim()) return false;
  try {
    const document = parseDocument(source);
    return document.definitions.some(
      (d) => d.kind === Kind.OPERATION_DEFINITION,
    );
  } catch {
    return false;
  }
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/documents/graphql.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documents/graphql.ts src/documents/graphql.test.ts
git commit -m "feat: add graphql schema fingerprinting and document detection"
```

---

### Task 3: Selection-set projection — scalars, objects, lists, nullability

The core of the response-side rule. This task covers the non-polymorphic cases; Task 4 adds fragments and abstract types.

**Files:**
- Create: `src/documents/graphqlProjection.ts`
- Create: `src/documents/graphqlProjection.test.ts`

**Interfaces:**
- Consumes: `parse` from `#documents/graphql`
- Produces:
  ```ts
  interface Projection { schema: SchemaObject; unvalidatableScalars: string[]; }
  function projectOperation(schema: GraphQLSchema, document: DocumentNode, operationName?: string): Projection
  ```
  `projectOperation` returns the schema for the **whole response envelope** (`{data, errors, extensions}`), with `required` still present — Task 5 strips it. `unvalidatableScalars` lists dotted response paths whose type is a custom scalar (U3).

- [ ] **Step 1: Write the failing tests**

Create `src/documents/graphqlProjection.test.ts`:

```ts
import { parse as parseDocument } from "graphql";
import { describe, expect, it } from "vitest";
import { parse as parseSchema } from "./graphql";
import { projectOperation } from "./graphqlProjection";

const schema = parseSchema(`
  scalar DateTime
  enum ProductStatus { ACTIVE DRAFT OUT_OF_STOCK ARCHIVED }
  type Money { amount: Float!, currency: String! }
  type Product {
    id: ID!
    name: String!
    description: String
    status: ProductStatus!
    tags: [String!]!
    price: Money
    createdAt: DateTime!
    stock: Int
    active: Boolean!
  }
  type Query { product(id: ID!): Product }
`);

const project = (source: string, operationName?: string) =>
  projectOperation(schema, parseDocument(source), operationName);

describe("projectOperation", () => {
  it("wraps the projection in a GraphQL response envelope", () => {
    const { schema: s } = project("{ product(id: 1) { id } }");
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties)).toEqual(["data", "errors", "extensions"]);
    expect(s.properties.errors).toBe(true);
    expect(s.properties.extensions).toBe(true);
  });

  it("maps built-in scalars to JSON Schema types", () => {
    const { schema: s } = project(
      "{ product(id: 1) { id name stock active } }",
    );
    const p = s.properties.data.properties.product.properties;
    expect(p.id).toEqual({ type: ["string", "integer"] });
    expect(p.name).toEqual({ type: "string" });
    expect(p.stock).toEqual({ type: ["integer", "null"] });
    expect(p.active).toEqual({ type: "boolean" });
  });

  it("maps enums to an enum constraint, adding null when nullable", () => {
    const { schema: s } = project("{ product(id: 1) { status } }");
    expect(s.properties.data.properties.product.properties.status).toEqual({
      enum: ["ACTIVE", "DRAFT", "OUT_OF_STOCK", "ARCHIVED"],
    });
  });

  it("makes nullable fields nullable", () => {
    const { schema: s } = project("{ product(id: 1) { description } }");
    expect(
      s.properties.data.properties.product.properties.description,
    ).toEqual({ type: ["string", "null"] });
  });

  it("projects lists", () => {
    const { schema: s } = project("{ product(id: 1) { tags } }");
    expect(s.properties.data.properties.product.properties.tags).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it("recurses into object types and closes them", () => {
    const { schema: s } = project("{ product(id: 1) { price { amount } } }");
    const price = s.properties.data.properties.product.properties.price;
    expect(price.type).toEqual(["object", "null"]);
    expect(price.additionalProperties).toBe(false);
    expect(price.properties).toEqual({ amount: { type: "number" } });
    expect(price.required).toEqual(["amount"]);
  });

  it("closes every object so unselected fields are rejected (P1)", () => {
    const { schema: s } = project("{ product(id: 1) { id } }");
    const product = s.properties.data.properties.product;
    expect(product.additionalProperties).toBe(false);
    expect(Object.keys(product.properties)).toEqual(["id"]);
  });

  it("keys properties by alias where one is used", () => {
    const { schema: s } = project("{ product(id: 1) { productId: id } }");
    expect(
      Object.keys(s.properties.data.properties.product.properties),
    ).toEqual(["productId"]);
  });

  it("accepts any value for a custom scalar and reports the path (U3)", () => {
    const { schema: s, unvalidatableScalars } = project(
      "{ product(id: 1) { createdAt } }",
    );
    expect(s.properties.data.properties.product.properties.createdAt).toBe(true);
    expect(unvalidatableScalars).toEqual(["data.product.createdAt"]);
  });

  it("makes data itself nullable (U2 is handled by the comparator)", () => {
    const { schema: s } = project("{ product(id: 1) { id } }");
    expect(s.properties.data.type).toEqual(["object", "null"]);
  });

  it("marks fields carrying @skip or @include as optional", () => {
    const { schema: s } = project(
      "query Q($d: Boolean!) { product(id: 1) { id name @include(if: $d) } }",
    );
    expect(s.properties.data.properties.product.required).toEqual(["id"]);
  });

  it("selects the named operation from a multi-operation document", () => {
    const { schema: s } = project(
      `query A { product(id: 1) { id } }
       query B { product(id: 1) { name } }`,
      "B",
    );
    expect(
      Object.keys(s.properties.data.properties.product.properties),
    ).toEqual(["name"]);
  });

  it("throws when the named operation is absent (R2)", () => {
    expect(() => project("query A { product(id: 1) { id } }", "Nope")).toThrow(
      /operation/i,
    );
  });

  it("throws when the document has several operations and no name (R2)", () => {
    expect(() =>
      project(`query A { product(id: 1) { id } }
               query B { product(id: 1) { name } }`),
    ).toThrow(/operation/i);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/documents/graphqlProjection.test.ts`
Expected: FAIL — cannot resolve `./graphqlProjection`.

- [ ] **Step 3: Implement**

Create `src/documents/graphqlProjection.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/documents/graphqlProjection.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/documents/graphqlProjection.ts src/documents/graphqlProjection.test.ts
git commit -m "feat: project graphql selection sets into json schema"
```

---

### Task 4: Projection — fragments, interfaces, unions, `__typename`

Completes the projection with polymorphism (P5). A response for an abstract type must match at least one possible concrete type, narrowed by `__typename` where recorded.

**Files:**
- Modify: `src/documents/graphqlProjection.ts`
- Modify: `src/documents/graphqlProjection.test.ts`

**Interfaces:**
- Consumes: everything from Task 3
- Produces: no signature change — `projectComposite` gains abstract-type handling internally

- [ ] **Step 1: Write the failing tests**

Append to `src/documents/graphqlProjection.test.ts`:

```ts
const polySchema = parseSchema(`
  interface Node { id: ID! }
  type Product implements Node { id: ID!, name: String! }
  type Category implements Node { id: ID!, slug: String! }
  union SearchResult = Product | Category
  type Query {
    node(id: ID!): Node
    search(text: String!): [SearchResult!]!
  }
`);

const projectPoly = (source: string, operationName?: string) =>
  projectOperation(polySchema, parseDocument(source), operationName);

describe("projectOperation with abstract types", () => {
  it("expands an interface into one branch per possible type", () => {
    const { schema: s } = projectPoly(
      "{ node(id: 1) { id ... on Product { name } ... on Category { slug } } }",
    );
    const node = s.properties.data.properties.node;
    expect(node.anyOf).toHaveLength(3); // Product, Category, null
    const branches = node.anyOf.filter((b: any) => b.type === "object");
    expect(branches.map((b: any) => Object.keys(b.properties).sort())).toEqual([
      ["id", "name"],
      ["id", "slug"],
    ]);
  });

  it("keeps interface-level fields required in every branch", () => {
    const { schema: s } = projectPoly(
      "{ node(id: 1) { id ... on Product { name } } }",
    );
    const branches = s.properties.data.properties.node.anyOf.filter(
      (b: any) => b.type === "object",
    );
    for (const branch of branches) expect(branch.required).toContain("id");
  });

  it("collapses to a single branch when no type conditions are used", () => {
    const { schema: s } = projectPoly("{ node(id: 1) { id } }");
    const node = s.properties.data.properties.node;
    expect(node.anyOf).toBeUndefined();
    expect(node.type).toEqual(["object", "null"]);
    expect(Object.keys(node.properties)).toEqual(["id"]);
  });

  it("expands a union", () => {
    const { schema: s } = projectPoly(
      "{ search(text: \"x\") { ... on Product { name } ... on Category { slug } } }",
    );
    const items = s.properties.data.properties.search.items;
    expect(items.anyOf).toHaveLength(2);
  });

  it("resolves named fragment spreads", () => {
    const { schema: s } = projectPoly(
      `{ node(id: 1) { id ...P } }
       fragment P on Product { name }`,
    );
    const branches = s.properties.data.properties.node.anyOf.filter(
      (b: any) => b.type === "object",
    );
    const product = branches.find((b: any) => "name" in b.properties);
    expect(Object.keys(product.properties).sort()).toEqual(["id", "name"]);
  });

  it("resolves an inline fragment with no type condition", () => {
    const { schema: s } = projectPoly("{ node(id: 1) { ... { id } } }");
    expect(
      Object.keys(s.properties.data.properties.node.properties),
    ).toEqual(["id"]);
  });

  it("constrains __typename to the possible type names in each branch", () => {
    const { schema: s } = projectPoly(
      "{ node(id: 1) { __typename id } }",
    );
    expect(s.properties.data.properties.node.properties.__typename).toEqual({
      enum: ["Product", "Category"],
    });
  });

  it("constrains __typename on a concrete object type to that one name", () => {
    const { schema: s } = projectPoly(
      "{ node(id: 1) { ... on Product { __typename name } } }",
    );
    const branches = s.properties.data.properties.node.anyOf.filter(
      (b: any) => b.type === "object",
    );
    const product = branches.find((b: any) => "name" in b.properties);
    expect(product.properties.__typename).toEqual({ enum: ["Product"] });
  });

  it("does not loop on a fragment that spreads itself", () => {
    // validate() rejects fragment cycles, but the projection must not hang
    // if a future caller skips validation.
    expect(() =>
      projectPoly(
        `{ node(id: 1) { ...P } }
         fragment P on Product { name ...P }`,
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/documents/graphqlProjection.test.ts`
Expected: FAIL — abstract types currently return `{ type: "object" }`.

- [ ] **Step 3: Replace `projectComposite` and the `__typename` handling**

In `src/documents/graphqlProjection.ts`, extend the imports:

```ts
import {
  // ...existing imports...
  type GraphQLObjectType,
  isAbstractType,
  isInterfaceType,
  isUnionType,
} from "graphql";
```

Replace the whole `projectComposite` function with:

```ts
/** The concrete object types a selection at `parentType` may resolve to. */
const possibleTypes = (
  parentType: GraphQLNamedType,
  ctx: Context,
): readonly GraphQLObjectType[] => {
  if (isObjectType(parentType)) return [parentType];
  if (isAbstractType(parentType)) return ctx.schema.getPossibleTypes(parentType);
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
```

Note the ordering constraint: `projectComposite` references `projectType` and vice versa. Both are `const` arrow functions, so they must be declared before `projectOperation` runs — which they are, since only `projectOperation` is called from outside. TypeScript will not complain, because the mutual reference resolves at call time.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/documents/graphqlProjection.test.ts`
Expected: PASS (23 tests). All Task 3 tests must still pass — in particular the `__typename` test in Task 3 expected `{ type: "string" }`; update that one assertion to `{ enum: ["Product"] }`-style for its schema, i.e. change it to expect `{ enum: ["Query"] }` is wrong — the Task 3 schema has no `__typename` test, so nothing to change. Confirm by running the full file.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/documents/graphqlProjection.ts src/documents/graphqlProjection.test.ts
git commit -m "feat: project graphql fragments, interfaces and unions"
```

---

### Task 5: Response schema builder — apply the subset relaxation

P7 and P8 say the consumer may omit any field. This repo already implements that rule for OpenAPI in `transform/responseSchema.ts` via `stripRequired`, which is currently private. Export it and build the GraphQL response schema on top.

**Files:**
- Modify: `src/transform/responseSchema.ts` (export `stripRequired`)
- Create: `src/transform/graphqlResponseSchema.ts`
- Create: `src/transform/graphqlResponseSchema.test.ts`

**Interfaces:**
- Consumes: `projectOperation` from `#documents/graphqlProjection`
- Produces: `graphqlResponseSchema(schema: GraphQLSchema, document: DocumentNode, operationName?: string): Projection` — same shape as `Projection`, with all `required` arrays removed

- [ ] **Step 1: Export `stripRequired`**

In `src/transform/responseSchema.ts`, change:

```ts
const stripRequired = (schema: SchemaObject): void => {
```

to:

```ts
export const stripRequired = (schema: SchemaObject): void => {
```

- [ ] **Step 2: Write the failing tests**

Create `src/transform/graphqlResponseSchema.test.ts`:

```ts
import { parse as parseDocument } from "graphql";
import { describe, expect, it } from "vitest";
import { parse as parseSchema } from "#documents/graphql";
import { graphqlResponseSchema } from "./graphqlResponseSchema";

const schema = parseSchema(`
  type Product { id: ID!, name: String!, price: Price }
  type Price { amount: Float! }
  type Query { product(id: ID!): Product }
`);

const build = (source: string) =>
  graphqlResponseSchema(schema, parseDocument(source)).schema;

describe("graphqlResponseSchema", () => {
  it("removes required at the top level (P7, P8)", () => {
    const s = build("{ product(id: 1) { id name } }");
    expect(s.properties.data.properties.product.required).toBeUndefined();
  });

  it("removes required at every nesting level", () => {
    const s = build("{ product(id: 1) { price { amount } } }");
    expect(
      s.properties.data.properties.product.properties.price.required,
    ).toBeUndefined();
  });

  it("keeps additionalProperties false so unselected fields still fail (P1)", () => {
    const s = build("{ product(id: 1) { id } }");
    expect(s.properties.data.properties.product.additionalProperties).toBe(false);
  });

  it("still surfaces unvalidatable scalars", () => {
    const withScalar = parseSchema(`
      scalar DateTime
      type Product { createdAt: DateTime! }
      type Query { product(id: ID!): Product }
    `);
    const { unvalidatableScalars } = graphqlResponseSchema(
      withScalar,
      parseDocument("{ product(id: 1) { createdAt } }"),
    );
    expect(unvalidatableScalars).toEqual(["data.product.createdAt"]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/transform/graphqlResponseSchema.test.ts`
Expected: FAIL — cannot resolve `./graphqlResponseSchema`.

- [ ] **Step 4: Implement**

Create `src/transform/graphqlResponseSchema.ts`:

```ts
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
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/transform/graphqlResponseSchema.test.ts && npx vitest run src/transform`
Expected: PASS — including the pre-existing `flattenAllOf` tests.

- [ ] **Step 6: Commit**

```bash
git add src/transform/responseSchema.ts src/transform/graphqlResponseSchema.ts src/transform/graphqlResponseSchema.test.ts
git commit -m "feat: build graphql response schemas with subset relaxation"
```

---

### Task 6: Result codes

TypeScript rejects any `Result` whose `code` is not in the union, so the codes must land before the comparison modules.

**Files:**
- Modify: `src/results/index.ts`

**Interfaces:**
- Produces: the code strings used by Tasks 8–13

- [ ] **Step 1: Add the codes**

In `src/results/index.ts`, extend the three unions. Keep each list alphabetically sorted, matching the existing style.

Add to `InfoCode`:

```ts
type InfoCode = "graphql.operation.matched" | "message.matched";
```

Add to `ErrorCode` (in alphabetical position):

```ts
  | "message.graphql.payload.incompatible"
  | "request.graphql.argument.missing"
  | "request.graphql.argument.unknown"
  | "request.graphql.document.invalid"
  | "request.graphql.field.unknown"
  | "request.graphql.incompatible"
  | "request.graphql.operation.unknown"
  | "request.graphql.variables.incompatible"
  | "response.graphql.body.incompatible"
```

Add to `WarningCode` (in alphabetical position):

```ts
  | "graphql.schema.mismatch"
  | "request.graphql.inconsistent"
  | "response.graphql.data.null"
  | "response.graphql.errors.unvalidatable"
  | "response.graphql.scalar.unvalidatable"
  | "response.graphql.status.unexpected"
```

- [ ] **Step 2: Verify types still compile**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/results/index.ts
git commit -m "feat: add graphql result codes"
```

---

### Task 7: Classify GraphQL HTTP interactions in the pact parser

**Files:**
- Modify: `src/documents/pact.ts`
- Modify: `src/documents/pact.test.ts`

**Interfaces:**
- Consumes: `looksLikeGraphqlDocument` from `#documents/graphql`
- Produces:
  ```ts
  interface GraphqlOperation {
    source: "plugin" | "body";
    document: string;
    operationName?: string;
    variables: Record<string, unknown>;
    inconsistent: boolean;
  }
  interface GraphqlPluginConfig {
    inlineSchemaSdl?: string;
    schemaHash?: string;
  }
  interface GraphqlHttpInteraction {
    _kind: "graphql-http";
    description?: string;
    providerState?: string;
    operation: GraphqlOperation;
    request: HttpInteraction["request"];
    response: HttpInteraction["response"];
    plugin?: GraphqlPluginConfig;
  }
  ```
  added to the exported `Interaction` union.

- [ ] **Step 1: Write the failing tests**

Append to `src/documents/pact.test.ts`:

```ts
import { parse } from "./pact";

const v4 = (interaction: unknown) => ({
  metadata: { pactSpecification: { version: "4.0" } },
  interactions: [interaction],
});

const GRAPHQL_QUERY = "query GetProduct($id: ID!) { product(id: $id) { id } }";

describe("graphql classification", () => {
  it("classifies an interaction carrying plugin configuration", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        description: "a GraphQL product request",
        pluginConfiguration: {
          graphql: {
            query_document: GRAPHQL_QUERY,
            operation_name: "GetProduct",
            variables_json: '{"id":"10"}',
            inline_schema: { base64_sdl: Buffer.from("type Query { a: String }").toString("base64") },
            schema_ref: { hash: "abc123" },
          },
        },
        request: {
          method: "POST",
          path: "/graphql",
          body: { contentType: "application/graphql", encoded: false, content: { query: GRAPHQL_QUERY, variables: { id: "10" }, operationName: "GetProduct" } },
        },
        response: { status: 200, body: { encoded: false, content: { data: { product: { id: "10" } } } } },
      }),
    ) as any;

    const i = interactions[0];
    expect(i._kind).toBe("graphql-http");
    expect(i.operation.source).toBe("plugin");
    expect(i.operation.document).toBe(GRAPHQL_QUERY);
    expect(i.operation.operationName).toBe("GetProduct");
    expect(i.operation.variables).toEqual({ id: "10" });
    expect(i.operation.inconsistent).toBe(false);
    expect(i.plugin.schemaHash).toBe("abc123");
    expect(i.plugin.inlineSchemaSdl).toBe("type Query { a: String }");
  });

  it("classifies a plain POST whose body is a graphql envelope", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: {
          method: "POST",
          path: "/graphql",
          body: { encoded: false, content: { query: GRAPHQL_QUERY, variables: { id: "10" } } },
        },
        response: { status: 200, body: { encoded: false, content: { data: {} } } },
      }),
    ) as any;

    expect(interactions[0]._kind).toBe("graphql-http");
    expect(interactions[0].operation.source).toBe("body");
  });

  it("does not misclassify a REST endpoint that takes a query string field", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: {
          method: "POST",
          path: "/search",
          body: { encoded: false, content: { query: "SELECT * FROM products" } },
        },
        response: { status: 200, body: { encoded: false, content: {} } },
      }),
    ) as any;

    expect(interactions[0]._kind).toBe("http");
  });

  it("does not misclassify a body carrying extra non-graphql keys", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: {
          method: "POST",
          path: "/search",
          body: { encoded: false, content: { query: GRAPHQL_QUERY, tenantId: "acme" } },
        },
        response: { status: 200, body: { encoded: false, content: {} } },
      }),
    ) as any;

    expect(interactions[0]._kind).toBe("http");
  });

  it("does not classify a GET as graphql", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: { method: "GET", path: "/graphql" },
        response: { status: 200, body: { encoded: false, content: {} } },
      }),
    ) as any;

    expect(interactions[0]._kind).toBe("http");
  });

  it("flags disagreement between plugin config and request body (4.1)", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        pluginConfiguration: {
          graphql: { query_document: GRAPHQL_QUERY, variables_json: '{"id":"10"}' },
        },
        request: {
          method: "POST",
          path: "/graphql",
          body: { encoded: false, content: { query: "{ somethingElse }", variables: { id: "99" } } },
        },
        response: { status: 200, body: { encoded: false, content: { data: {} } } },
      }),
    ) as any;

    expect(interactions[0].operation.inconsistent).toBe(true);
    expect(interactions[0].operation.document).toBe(GRAPHQL_QUERY);
  });

  it("leaves REST interactions untouched", () => {
    const { interactions } = parse(
      v4({
        type: "Synchronous/HTTP",
        request: { method: "GET", path: "/products" },
        response: { status: 200, body: { encoded: false, content: [] } },
      }),
    ) as any;

    expect(interactions[0]._kind).toBe("http");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/documents/pact.test.ts`
Expected: FAIL — every classification test reports `_kind` as `"http"`.

- [ ] **Step 3: Implement**

In `src/documents/pact.ts`:

Add the import at the top:

```ts
import { looksLikeGraphqlDocument } from "#documents/graphql";
```

Add `pluginConfiguration` to `RawInteraction`:

```ts
  pluginConfiguration?: {
    graphql?: {
      query_document?: string;
      operation_name?: string;
      variables_json?: string;
      inline_schema?: { base64_sdl?: string };
      schema_ref?: { hash?: string };
    };
  };
```

Add the new exported types next to `HttpInteraction`:

```ts
export interface GraphqlOperation {
  /** Which part of the pact the operation was read from. */
  source: "plugin" | "body";
  document: string;
  operationName?: string;
  variables: Record<string, unknown>;
  /** Plugin configuration and request body disagree (requirements 4.1). */
  inconsistent: boolean;
}

export interface GraphqlPluginConfig {
  inlineSchemaSdl?: string;
  schemaHash?: string;
}

export interface GraphqlHttpInteraction {
  _kind: "graphql-http";
  description?: string;
  providerState?: string;
  operation: GraphqlOperation;
  request: HttpInteraction["request"];
  response: HttpInteraction["response"];
  plugin?: GraphqlPluginConfig;
}
```

Extend the union:

```ts
export type Interaction =
  | HttpInteraction
  | GraphqlHttpInteraction
  | AsyncInteraction
  | SyncInteraction
  | SkippedInteraction;
```

Add the classification helpers above `parse`:

```ts
const GRAPHQL_BODY_KEYS = new Set([
  "query",
  "variables",
  "operationName",
  "extensions",
]);

interface GraphqlEnvelope {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

/** The request body read as a GraphQL over HTTP envelope, if it is one. */
const asGraphqlEnvelope = (body: unknown): GraphqlEnvelope | undefined => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((k) => !GRAPHQL_BODY_KEYS.has(k))) return undefined;
  if (typeof record.query !== "string") return undefined;
  return {
    query: record.query,
    variables: (record.variables as Record<string, unknown>) ?? undefined,
    operationName:
      typeof record.operationName === "string" ? record.operationName : undefined,
  };
};

const parseJsonObject = (value?: string): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const decodeBase64 = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return undefined;
  }
};

/**
 * Requirements section 4: an interaction is GraphQL when it carries plugin
 * configuration, declares an `application/graphql` content type, or is a POST
 * whose body is a GraphQL envelope containing a parseable operation.
 */
const asGraphqlHttpInteraction = (
  parsed: HttpInteraction,
  raw: RawInteraction,
): GraphqlHttpInteraction | undefined => {
  const pluginConfig = raw.pluginConfiguration?.graphql;
  const envelope = asGraphqlEnvelope(parsed.request.body);

  const contentType =
    parsed.request.headers?.["content-type"] ??
    parsed.request.headers?.["Content-Type"] ??
    (raw.request?.body as { contentType?: string } | undefined)?.contentType;

  const declaredGraphql =
    typeof contentType === "string" &&
    contentType.toLowerCase().startsWith("application/graphql");

  const heuristicGraphql =
    parsed.request.method.toUpperCase() === "POST" &&
    envelope !== undefined &&
    looksLikeGraphqlDocument(envelope.query);

  if (!pluginConfig && !declaredGraphql && !heuristicGraphql) return undefined;

  const pluginDocument = pluginConfig?.query_document;
  const pluginVariables = parseJsonObject(pluginConfig?.variables_json);

  const document = pluginDocument ?? envelope?.query;
  if (!document) return undefined;

  const source: "plugin" | "body" = pluginDocument ? "plugin" : "body";
  const variables = pluginDocument ? pluginVariables : (envelope?.variables ?? {});
  const operationName = pluginDocument
    ? pluginConfig?.operation_name
    : envelope?.operationName;

  const inconsistent = Boolean(
    pluginDocument &&
      envelope &&
      (envelope.query !== pluginDocument ||
        JSON.stringify(envelope.variables ?? {}) !==
          JSON.stringify(pluginVariables)),
  );

  const inlineSchemaSdl = decodeBase64(pluginConfig?.inline_schema?.base64_sdl);
  const schemaHash = pluginConfig?.schema_ref?.hash;

  return {
    _kind: "graphql-http",
    description: parsed.description,
    providerState: parsed.providerState,
    operation: { source, document, operationName, variables, inconsistent },
    request: parsed.request,
    response: parsed.response,
    plugin:
      inlineSchemaSdl || schemaHash ? { inlineSchemaSdl, schemaHash } : undefined,
  };
};
```

Finally, in `parse()`, reclassify after the HTTP parser runs:

```ts
    interactions: rawInteractions.map((i): Interaction => {
      if (isHttpInteraction(i)) {
        const parsed = httpParser(i);
        return asGraphqlHttpInteraction(parsed, i) ?? parsed;
      }
      if (isAsyncInteraction(i)) return parseAsyncInteraction(i);
      if (isSyncInteraction(i)) return parseSyncInteraction(i);
      return { _kind: "skip" };
    }),
```

Reclassifying *after* `httpParser` means the body has already been decoded per pact specification version, so v3 and v4 pacts classify identically with no version-specific branch.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/documents/pact.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix the exhaustiveness error in the comparator**

`src/compare/index.ts` has `interaction satisfies never` in its `default` branch, which now fails to compile. Add a temporary case above `default` so the build stays green until Task 10 wires it properly:

```ts
        case "graphql-http":
          break;
```

- [ ] **Step 6: Verify the whole suite and types**

Run: `npm test -- --run && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/documents/pact.ts src/documents/pact.test.ts src/compare/index.ts
git commit -m "feat: classify graphql http interactions in the pact parser"
```

---

### Task 8: Request-side comparison (R1–R9)

**Files:**
- Create: `src/compare/graphql/requestOperation.ts`
- Create: `src/compare/graphql/requestOperation.test.ts`

**Interfaces:**
- Consumes: `GraphqlHttpInteraction` from `#documents/pact`, `selectOperation`/`ProjectionError` from `#documents/graphqlProjection`
- Produces:
  ```ts
  interface RequestCheck {
    results: Result[];
    document?: DocumentNode;   // present only when the request is compatible
  }
  function compareRequestOperation(
    schema: GraphQLSchema,
    interaction: GraphqlHttpInteraction,
    index: number,
  ): RequestCheck
  ```
  A `document` is returned only when no error result was produced, so the caller knows whether the response check can proceed.

- [ ] **Step 1: Write the failing tests**

Create `src/compare/graphql/requestOperation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parse as parseSchema } from "#documents/graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import { compareRequestOperation } from "./requestOperation";

const schema = parseSchema(`
  enum ProductStatus { ACTIVE DRAFT }
  type Product { id: ID!, name: String!, status: ProductStatus! }
  type Query { product(id: ID!): Product, products(status: ProductStatus): [Product!]! }
`);

const interaction = (
  document: string,
  variables: Record<string, unknown> = {},
  operationName?: string,
): GraphqlHttpInteraction => ({
  _kind: "graphql-http",
  description: "an interaction",
  providerState: "a state",
  operation: { source: "body", document, operationName, variables, inconsistent: false },
  request: { method: "POST", path: "/graphql" },
  response: { status: 200 },
});

const codes = (document: string, variables?: Record<string, unknown>) =>
  compareRequestOperation(schema, interaction(document, variables), 0).results.map(
    (r) => r.code,
  );

describe("compareRequestOperation", () => {
  it("passes an operation that selects fewer fields (R10)", () => {
    const check = compareRequestOperation(
      schema,
      interaction("query Q($id: ID!) { product(id: $id) { id } }", { id: "1" }),
      0,
    );
    expect(check.results).toEqual([]);
    expect(check.document).toBeDefined();
  });

  it("reports a syntax error (R1)", () => {
    expect(codes("query {")).toEqual(["request.graphql.document.invalid"]);
  });

  it("reports a missing named operation (R2)", () => {
    const check = compareRequestOperation(
      schema,
      interaction("query A { product(id: 1) { id } }", {}, "B"),
      0,
    );
    expect(check.results.map((r) => r.code)).toEqual([
      "request.graphql.operation.unknown",
    ]);
    expect(check.document).toBeUndefined();
  });

  it("reports an unknown field (R4)", () => {
    expect(codes("{ product(id: 1) { id stockLevel } }")).toEqual([
      "request.graphql.field.unknown",
    ]);
  });

  it("reports an unknown root field (R3)", () => {
    expect(codes("{ nope { id } }")).toEqual(["request.graphql.field.unknown"]);
  });

  it("reports a missing required argument (R6)", () => {
    expect(codes("{ product { id } }")).toEqual([
      "request.graphql.argument.missing",
    ]);
  });

  it("reports an unknown argument (R5)", () => {
    expect(codes("{ product(id: 1, colour: \"red\") { id } }")).toEqual([
      "request.graphql.argument.unknown",
    ]);
  });

  it("reports an invalid enum literal (R7)", () => {
    expect(codes("{ products(status: PENDING) { id } }")).toEqual([
      "request.graphql.incompatible",
    ]);
  });

  it("reports a missing required variable (R8)", () => {
    expect(codes("query Q($id: ID!) { product(id: $id) { id } }", {})).toEqual([
      "request.graphql.variables.incompatible",
    ]);
  });

  it("reports a variable of the wrong type (R8)", () => {
    expect(
      codes("query Q($status: ProductStatus!) { products(status: $status) { id } }", {
        status: "PENDING",
      }),
    ).toEqual(["request.graphql.variables.incompatible"]);
  });

  it("reports a fragment on an unknown type (R9)", () => {
    expect(
      codes("{ product(id: 1) { ... on Nope { id } } }"),
    ).toEqual(["request.graphql.incompatible"]);
  });

  it("warns when plugin config and body disagree (4.1)", () => {
    const i = interaction("{ product(id: 1) { id } }");
    i.operation.inconsistent = true;
    i.operation.source = "plugin";
    const results = compareRequestOperation(schema, i, 0).results;
    expect(results.map((r) => r.code)).toEqual(["request.graphql.inconsistent"]);
    expect(results[0].type).toBe("warning");
  });

  it("carries pact and schema locations on each result", () => {
    const [result] = compareRequestOperation(
      schema,
      interaction("{ product(id: 1) { id stockLevel } }"),
      3,
    ).results;
    expect(result.mockDetails?.location).toBe(
      "[root].interactions[3].request.body.content.query",
    );
    expect(result.mockDetails?.interactionDescription).toBe("an interaction");
    expect(result.mockDetails?.interactionState).toBe("a state");
    expect(result.specDetails?.location).toBe("[root].Product");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/compare/graphql/requestOperation.test.ts`
Expected: FAIL — cannot resolve `./requestOperation`.

- [ ] **Step 3: Implement**

Create `src/compare/graphql/requestOperation.ts`:

```ts
import {
  type DocumentNode,
  type GraphQLError,
  type GraphQLSchema,
  Kind,
  parse as parseDocument,
  validate,
} from "graphql";
import { coerceInputValue, typeFromAST } from "graphql";
import { ProjectionError, selectOperation } from "#documents/graphqlProjection";
import type { GraphqlHttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";

export interface RequestCheck {
  results: Result[];
  /** Present only when the request is compatible, so the caller may proceed. */
  document?: DocumentNode;
}

/**
 * Maps a GraphQL validation error onto a specific result code. graphql-js does
 * not expose the rule that produced an error, so the message is the only
 * signal available; anything unrecognised falls back to the catch-all, which
 * still reports the full GraphQL message.
 */
const codeForValidationError = (
  error: GraphQLError,
): Extract<Result["code"], `request.graphql.${string}`> => {
  const message = error.message;
  if (/^Unknown argument /.test(message)) return "request.graphql.argument.unknown";
  if (/^Field .* argument .* of type .* is required/.test(message)) {
    return "request.graphql.argument.missing";
  }
  if (/^Cannot query field /.test(message)) return "request.graphql.field.unknown";
  if (/^Unknown type /.test(message)) return "request.graphql.incompatible";
  return "request.graphql.incompatible";
};

/** `[root].<TypeName>` where the error names a type, for specDetails. */
const specLocation = (error: GraphQLError): string => {
  const match =
    /on type "([^"]+)"/.exec(error.message) ??
    /Field "([^".]+)\./.exec(error.message);
  return match ? `[root].${match[1]}` : "[root]";
};

const position = (error: GraphQLError): string => {
  const loc = error.locations?.[0];
  return loc ? ` (line ${loc.line}, column ${loc.column})` : "";
};

export const compareRequestOperation = (
  schema: GraphQLSchema,
  interaction: GraphqlHttpInteraction,
  index: number,
): RequestCheck => {
  const results: Result[] = [];
  const queryLocation = `[root].interactions[${index}].request.body.content.query`;
  const mock = (location: string, value: unknown) => ({
    ...baseMockDetails(interaction),
    location,
    value,
  });

  if (interaction.operation.inconsistent) {
    results.push({
      code: "request.graphql.inconsistent",
      message:
        "The GraphQL operation in the request body differs from the one in pluginConfiguration.graphql; the plugin configuration was used",
      mockDetails: mock(queryLocation, interaction.operation.document),
      specDetails: { location: "[root]", value: undefined },
      type: "warning",
    });
  }

  // R1
  let document: DocumentNode;
  try {
    document = parseDocument(interaction.operation.document);
  } catch (e) {
    results.push({
      code: "request.graphql.document.invalid",
      message: `GraphQL document could not be parsed: ${(e as Error).message}`,
      mockDetails: mock(queryLocation, interaction.operation.document),
      specDetails: { location: "[root]", value: undefined },
      type: "error",
    });
    return { results };
  }

  // R2
  let operation;
  try {
    operation = selectOperation(document, interaction.operation.operationName);
  } catch (e) {
    if (!(e instanceof ProjectionError)) throw e;
    results.push({
      code: "request.graphql.operation.unknown",
      message: e.message,
      mockDetails: mock(
        `[root].interactions[${index}].request.body.content.operationName`,
        interaction.operation.operationName,
      ),
      specDetails: { location: "[root]", value: undefined },
      type: "error",
    });
    return { results };
  }

  // R3-R7, R9
  const validationErrors = validate(schema, document);
  for (const error of validationErrors) {
    results.push({
      code: codeForValidationError(error),
      message: `${error.message}${position(error)}`,
      mockDetails: mock(queryLocation, interaction.operation.document),
      specDetails: { location: specLocation(error), value: undefined },
      type: "error",
    });
  }

  // R8 — validate() never sees runtime values, so variables need their own pass
  for (const definition of operation.variableDefinitions ?? []) {
    const name = definition.variable.name.value;
    const type = typeFromAST(schema, definition.type);
    if (!type) continue; // an unknown variable type is already an R9 error

    const supplied = Object.prototype.hasOwnProperty.call(
      interaction.operation.variables,
      name,
    );
    const required =
      definition.type.kind === Kind.NON_NULL_TYPE && !definition.defaultValue;

    if (!supplied) {
      if (required) {
        results.push({
          code: "request.graphql.variables.incompatible",
          message: `Variable "$${name}" is required but was not provided`,
          mockDetails: mock(
            `[root].interactions[${index}].request.body.content.variables`,
            interaction.operation.variables,
          ),
          specDetails: { location: "[root]", value: undefined },
          type: "error",
        });
      }
      continue;
    }

    const errors: string[] = [];
    coerceInputValue(
      interaction.operation.variables[name],
      type,
      (_path, _invalidValue, error) => errors.push(error.message),
    );

    for (const message of errors) {
      results.push({
        code: "request.graphql.variables.incompatible",
        message: `Variable "$${name}" is incompatible with its declared type: ${message}`,
        mockDetails: mock(
          `[root].interactions[${index}].request.body.content.variables.${name}`,
          interaction.operation.variables[name],
        ),
        specDetails: { location: "[root]", value: undefined },
        type: "error",
      });
    }
  }

  const failed = results.some((r) => r.type === "error");
  return { results, document: failed ? undefined : document };
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/compare/graphql/requestOperation.test.ts`
Expected: PASS (13 tests).

If `codeForValidationError`'s regexes do not match your installed graphql-js version's message wording, adjust the regexes — do not change the tests. The exact codes are the contract; graphql-js message text is the implementation detail.

- [ ] **Step 5: Commit**

```bash
git add src/compare/graphql/requestOperation.ts src/compare/graphql/requestOperation.test.ts
git commit -m "feat: compare graphql requests against the provider schema"
```

---

### Task 9: Response-side comparison (P1–P8, U1–U4)

**Files:**
- Create: `src/compare/graphql/responseBody.ts`
- Create: `src/compare/graphql/responseBody.test.ts`

**Interfaces:**
- Consumes: `graphqlResponseSchema` from `#transform/graphqlResponseSchema`
- Produces:
  ```ts
  function compareResponseBody(
    ajv: Ajv,
    schema: GraphQLSchema,
    document: DocumentNode,
    interaction: GraphqlHttpInteraction,
    index: number,
  ): Result[]
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/compare/graphql/responseBody.test.ts`:

```ts
import { parse as parseDocument } from "graphql";
import { describe, expect, it } from "vitest";
import { parse as parseSchema } from "#documents/graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import { setupAjv } from "#compare/setup";
import { compareResponseBody } from "./responseBody";

const ajv = setupAjv({ allErrors: true, coerceTypes: false, strictSchema: false, logger: false });

const schema = parseSchema(`
  scalar DateTime
  enum ProductStatus { ACTIVE DRAFT }
  type Product { id: ID!, name: String!, description: String, status: ProductStatus!, createdAt: DateTime! }
  type Query { product(id: ID!): Product }
`);

const QUERY = "{ product(id: 1) { id name status } }";

const interaction = (body: unknown, status = 200): GraphqlHttpInteraction => ({
  _kind: "graphql-http",
  description: "an interaction",
  providerState: "a state",
  operation: { source: "body", document: QUERY, variables: {}, inconsistent: false },
  request: { method: "POST", path: "/graphql" },
  response: { status, body },
});

const run = (body: unknown, status = 200, query = QUERY) =>
  compareResponseBody(
    ajv,
    schema,
    parseDocument(query),
    interaction(body, status),
    0,
  );

const ok = { data: { product: { id: "10", name: "n", status: "ACTIVE" } } };

describe("compareResponseBody", () => {
  it("passes a fully populated response", () => {
    expect(run(ok)).toEqual([]);
  });

  it("passes when the consumer omits a field it selected (P7)", () => {
    expect(run({ data: { product: { id: "10" } } })).toEqual([]);
  });

  it("passes when the consumer omits a non-null field (P8)", () => {
    expect(run({ data: { product: { name: "n" } } })).toEqual([]);
  });

  it("rejects a field the operation never selected (P1)", () => {
    const results = run({ data: { product: { id: "10", description: "d" } } });
    expect(results.map((r) => r.code)).toEqual(["response.graphql.body.incompatible"]);
    expect(results[0].type).toBe("error");
  });

  it("rejects a scalar of the wrong type (P2)", () => {
    expect(run({ data: { product: { name: 42 } } }).map((r) => r.code)).toEqual([
      "response.graphql.body.incompatible",
    ]);
  });

  it("rejects a value outside the enum (P3)", () => {
    expect(
      run({ data: { product: { status: "PENDING" } } }).map((r) => r.code),
    ).toEqual(["response.graphql.body.incompatible"]);
  });

  it("rejects null on a non-null field when no errors key is present (P4)", () => {
    expect(run({ data: { product: { id: null } } }).map((r) => r.code)).toEqual([
      "response.graphql.body.incompatible",
    ]);
  });

  it("accepts null on a nullable field", () => {
    const results = run(
      { data: { product: { description: null } } },
      200,
      "{ product(id: 1) { description } }",
    );
    expect(results).toEqual([]);
  });

  it("rejects an unknown envelope key (P6)", () => {
    expect(run({ data: {}, meta: {} }).map((r) => r.code)).toEqual([
      "response.graphql.body.incompatible",
    ]);
  });

  it("warns and skips data checks when errors are present (U1)", () => {
    const results = run({ errors: [{ message: "boom" }], data: null });
    expect(results.map((r) => r.code)).toEqual(["response.graphql.errors.unvalidatable"]);
    expect(results[0].type).toBe("warning");
  });

  it("warns and skips when data is null (U2)", () => {
    const results = run({ data: null });
    expect(results.map((r) => r.code)).toEqual(["response.graphql.data.null"]);
    expect(results[0].type).toBe("warning");
  });

  it("warns for a custom scalar and accepts any value (U3)", () => {
    const results = run(
      { data: { product: { createdAt: 12345 } } },
      200,
      "{ product(id: 1) { createdAt } }",
    );
    expect(results.map((r) => r.code)).toEqual([
      "response.graphql.scalar.unvalidatable",
    ]);
    expect(results[0].type).toBe("warning");
  });

  it("warns and skips body checks on a transport failure (U4)", () => {
    const results = run({ anything: true }, 500);
    expect(results.map((r) => r.code)).toEqual(["response.graphql.status.unexpected"]);
    expect(results[0].type).toBe("warning");
  });

  it("carries pact and schema locations", () => {
    const [result] = run({ data: { product: { status: "PENDING" } } });
    expect(result.mockDetails?.location).toBe(
      "[root].interactions[0].response.body.content.data.product.status",
    );
    expect(result.mockDetails?.interactionDescription).toBe("an interaction");
    expect(result.specDetails?.location).toBe("[root].Query");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/compare/graphql/responseBody.test.ts`
Expected: FAIL — cannot resolve `./responseBody`.

- [ ] **Step 3: Implement**

Create `src/compare/graphql/responseBody.ts`:

```ts
import type Ajv from "ajv/dist/2019";
import type { DocumentNode, GraphQLSchema } from "graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import {
  baseMockDetails,
  formatInstancePath,
  formatMessage,
} from "#results/index";
import { graphqlResponseSchema } from "#transform/graphqlResponseSchema";

export const compareResponseBody = (
  ajv: Ajv,
  schema: GraphQLSchema,
  document: DocumentNode,
  interaction: GraphqlHttpInteraction,
  index: number,
): Result[] => {
  const results: Result[] = [];
  const bodyLocation = `[root].interactions[${index}].response.body.content`;
  const mock = (location: string, value: unknown) => ({
    ...baseMockDetails(interaction),
    location,
    value,
  });

  // U4 — a transport failure says nothing about schema compatibility
  if (interaction.response.status >= 400) {
    return [
      {
        code: "response.graphql.status.unexpected",
        message: `Response status ${interaction.response.status} is a transport failure; the GraphQL response body was not checked`,
        mockDetails: mock(
          `[root].interactions[${index}].response.status`,
          interaction.response.status,
        ),
        specDetails: { location: "[root]", value: undefined },
        type: "warning",
      },
    ];
  }

  const body = interaction.response.body;
  if (body === undefined || body === null) return results;

  const envelope = body as Record<string, unknown>;

  // U1 — error payloads are not described by the schema
  if (envelope.errors !== undefined) {
    return [
      {
        code: "response.graphql.errors.unvalidatable",
        message:
          "Response contains a GraphQL errors key; error payloads are not described by the schema, so data was not checked",
        mockDetails: mock(`${bodyLocation}.errors`, envelope.errors),
        specDetails: { location: "[root]", value: undefined },
        type: "warning",
      },
    ];
  }

  // U2
  if (envelope.data === null) {
    return [
      {
        code: "response.graphql.data.null",
        message: "Response data is null, so no fields could be checked",
        mockDetails: mock(`${bodyLocation}.data`, null),
        specDetails: { location: "[root]", value: undefined },
        type: "warning",
      },
    ];
  }

  const { schema: responseSchema, unvalidatableScalars } = graphqlResponseSchema(
    schema,
    document,
  );

  // U3
  for (const path of unvalidatableScalars) {
    results.push({
      code: "response.graphql.scalar.unvalidatable",
      message: `Custom scalar at ${path} cannot be validated; any value is accepted`,
      mockDetails: mock(`${bodyLocation}.${path}`, undefined),
      specDetails: { location: "[root]", value: undefined },
      type: "warning",
    });
  }

  const validate = ajv.compile(responseSchema);
  if (validate(body)) return results;

  for (const error of validate.errors ?? []) {
    results.push({
      code: "response.graphql.body.incompatible",
      message: `Response body is incompatible with the GraphQL schema: ${formatMessage(error)}`,
      mockDetails: mock(
        `${bodyLocation}${formatInstancePath(error)}`,
        interaction.response.body,
      ),
      specDetails: {
        location: `[root].${rootTypeName(schema, document)}`,
        value: undefined,
      },
      type: "error",
    });
  }

  return results;
};

const rootTypeName = (
  schema: GraphQLSchema,
  document: DocumentNode,
): string => {
  const operation = document.definitions.find(
    (d): d is import("graphql").OperationDefinitionNode =>
      d.kind === "OperationDefinition",
  );
  const type =
    operation?.operation === "mutation"
      ? schema.getMutationType()
      : operation?.operation === "subscription"
        ? schema.getSubscriptionType()
        : schema.getQueryType();
  return type?.name ?? "Query";
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/compare/graphql/responseBody.test.ts`
Expected: PASS (14 tests).

If the `mockDetails.location` test fails because AJV reports a slightly different `instancePath`, adjust the expected string in the test to whatever AJV actually produces — that assertion documents behaviour rather than specifying it.

- [ ] **Step 5: Commit**

```bash
git add src/compare/graphql/responseBody.ts src/compare/graphql/responseBody.test.ts
git commit -m "feat: compare graphql response bodies against projected schemas"
```

---

### Task 10: Wire it together — orchestration, `ComparatorOptions.graphql`, routing

Makes the feature reachable end to end for queries and mutations.

**Files:**
- Create: `src/compare/graphql/index.ts`
- Modify: `src/compare/index.ts`
- Modify: `src/index.ts`
- Create: `src/compare/graphql/index.test.ts`

**Interfaces:**
- Consumes: `compareRequestOperation` (Task 8), `compareResponseBody` (Task 9)
- Produces:
  ```ts
  function* compareGraphqlHttpInteraction(
    ajv: Ajv,
    schema: GraphQLSchema,
    interaction: GraphqlHttpInteraction,
    index: number,
  ): Iterable<Result>
  ```
  and `ComparatorOptions.graphql?: string`

- [ ] **Step 1: Write the failing test**

Create `src/compare/graphql/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Comparator } from "#compare/index";

const SDL = `
  enum ProductStatus { ACTIVE DRAFT }
  type Product { id: ID!, name: String!, status: ProductStatus! }
  type Query { product(id: ID!): Product }
`;

const QUERY = "query GetProduct($id: ID!) { product(id: $id) { id name } }";

const pact = (overrides: Record<string, unknown> = {}) => ({
  consumer: { name: "c" },
  provider: { name: "p" },
  metadata: { pactSpecification: { version: "4.0" } },
  interactions: [
    {
      type: "Synchronous/HTTP",
      description: "a GraphQL product request",
      request: {
        method: "POST",
        path: "/graphql",
        body: {
          encoded: false,
          content: { query: QUERY, variables: { id: "10" } },
        },
      },
      response: {
        status: 200,
        body: { encoded: false, content: { data: { product: { id: "10", name: "n" } } } },
      },
      ...overrides,
    },
  ],
});

const collect = async (options: object, doc: unknown) => {
  const results = [];
  for await (const r of new Comparator(options).compare(doc as never)) results.push(r);
  return results;
};

describe("Comparator with a graphql provider contract", () => {
  it("emits a matched result for a compatible interaction", async () => {
    const results = await collect({ graphql: SDL }, pact());
    expect(results.map((r) => r.code)).toEqual(["graphql.operation.matched"]);
    expect(results[0].type).toBe("info");
  });

  it("reports an incompatible request", async () => {
    const bad = pact();
    (bad.interactions[0] as any).request.body.content.query =
      "query GetProduct($id: ID!) { product(id: $id) { id stockLevel } }";
    const results = await collect({ graphql: SDL }, bad);
    expect(results.map((r) => r.code)).toEqual(["request.graphql.field.unknown"]);
  });

  it("skips the response check when the request is incompatible", async () => {
    const bad = pact();
    (bad.interactions[0] as any).request.body.content.query = "{ nope { id } }";
    const results = await collect({ graphql: SDL }, bad);
    expect(results.every((r) => r.code.startsWith("request."))).toBe(true);
  });

  it("skips graphql interactions when no SDL was supplied", async () => {
    expect(await collect({}, pact())).toEqual([]);
  });

  it("throws on malformed SDL", () => {
    expect(() => new Comparator({ graphql: "type Query {" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/compare/graphql/index.test.ts`
Expected: FAIL — `graphql` is not a valid `ComparatorOptions` key.

- [ ] **Step 3: Write the orchestrator**

Create `src/compare/graphql/index.ts`:

```ts
import type Ajv from "ajv/dist/2019";
import type { GraphQLSchema } from "graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { compareRequestOperation } from "./requestOperation";
import { compareResponseBody } from "./responseBody";

export function* compareGraphqlHttpInteraction(
  ajv: Ajv,
  schema: GraphQLSchema,
  interaction: GraphqlHttpInteraction,
  index: number,
): Iterable<Result> {
  const request = compareRequestOperation(schema, interaction, index);
  yield* request.results;

  // A request that cannot be satisfied makes the response meaningless: the
  // projection would be derived from an operation the provider cannot serve.
  if (!request.document) return;

  const responseResults = compareResponseBody(
    ajv,
    schema,
    request.document,
    interaction,
    index,
  );
  yield* responseResults;

  if (!responseResults.some((r) => r.type === "error")) {
    yield {
      code: "graphql.operation.matched",
      message: `Matched GraphQL operation ${interaction.operation.operationName ?? "(anonymous)"}`,
      specDetails: { location: "[root]", value: undefined },
      type: "info",
    };
  }
}
```

- [ ] **Step 4: Wire the Comparator**

In `src/compare/index.ts`:

Add imports:

```ts
import type { GraphQLSchema } from "graphql";
import { compareGraphqlHttpInteraction } from "#compare/graphql/index";
import { parse as parseGraphqlSchema } from "#documents/graphql";
```

Extend the options interface:

```ts
export interface ComparatorOptions {
  oas?: OpenAPIV2.Document | OpenAPIV3.Document;
  asyncapi?: AsyncAPIDocument;
  /** Provider contract as GraphQL SDL text. */
  graphql?: string;
}
```

Add fields and constructor handling:

```ts
  #graphql?: GraphQLSchema;
```

and in the constructor, alongside the existing parse calls:

```ts
    if (options.graphql) this.#graphql = parseGraphqlSchema(options.graphql);
```

Replace the temporary `case "graphql-http": break;` from Task 7 with:

```ts
        case "graphql-http":
          if (!this.#graphql) break;
          yield* compareGraphqlHttpInteraction(
            this.#ajvNocoerce,
            this.#graphql,
            interaction,
            index,
          );
          break;
```

The existing `case "http"` already guards with `if (this.#asyncapi && !this.#oas) break;`. Change it to skip whenever no OAS is present, so a GraphQL-only run does not attempt REST comparisons:

```ts
        case "http":
          if (!this.#oas) break;
          yield* compareHttpInteraction(/* unchanged arguments */);
          break;
```

This is also what makes mixed REST + GraphQL pacts work: each interaction routes against the contract for its own kind, and supplying both `oas` and `graphql` compares both halves in one run.

- [ ] **Step 5: Export the option type**

In `src/index.ts`, the existing `export * from "./compare"` already re-exports `ComparatorOptions`. Confirm no change is needed by running the typecheck in the next step.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/compare && npm run typecheck && npm run lint`
Expected: PASS, including all pre-existing OAS and AsyncAPI comparison tests.

- [ ] **Step 7: Commit**

```bash
git add src/compare/graphql/index.ts src/compare/graphql/index.test.ts src/compare/index.ts
git commit -m "feat: route graphql interactions through the comparator"
```

---

### Task 11: Fixture harness and end-to-end fixtures

**Files:**
- Modify: `src/__tests__/index.test.ts`
- Create: `src/__tests__/fixtures/graphql/<case>/{schema.graphql,pact.json}` (11 cases)

**Interfaces:**
- Consumes: the full comparator from Task 10
- Produces: generated `results.json` snapshots

- [ ] **Step 1: Teach the harness to read `schema.graphql`**

In `src/__tests__/index.test.ts`, inside `makeRunner`, add alongside the existing spec loading:

```ts
  const graphqlFile = path.join(dir, "schema.graphql");

  const graphql = fs.existsSync(graphqlFile)
    ? await fs.promises.readFile(graphqlFile, "utf-8")
    : undefined;
```

and pass it through:

```ts
  const comparator = new Comparator({ oas, asyncapi, graphql });
```

Note `schema.graphql` is read as **raw text**, not through `parse()` — SDL is neither JSON nor YAML.

- [ ] **Step 2: Create the shared schema**

Create `src/__tests__/fixtures/graphql/valid-subset/schema.graphql`:

```graphql
scalar DateTime

enum ProductStatus {
  ACTIVE
  DRAFT
  OUT_OF_STOCK
  ARCHIVED
}

interface Node {
  id: ID!
}

type Product implements Node {
  id: ID!
  sku: String!
  name: String!
  description: String
  status: ProductStatus!
  tags: [String!]!
  createdAt: DateTime!
}

type Category implements Node {
  id: ID!
  slug: String!
}

union SearchResult = Product | Category

type Query {
  product(id: ID!): Product
  products(status: ProductStatus): [Product!]!
  search(text: String!): [SearchResult!]!
  node(id: ID!): Node
}

type Mutation {
  archiveProduct(id: ID!): Product!
}
```

Copy this same file into each of the other fixture directories created below. (Duplication is deliberate: each fixture directory must be self-contained, matching how the existing `oas` and `asyncapi` fixtures work.)

- [ ] **Step 3: Create the pact for each case**

Each `pact.json` uses this envelope, varying only the interaction:

```json
{
  "consumer": { "name": "product-consumer" },
  "provider": { "name": "product-provider" },
  "metadata": { "pactSpecification": { "version": "4.0" } },
  "interactions": [ /* see each case */ ]
}
```

Create these eleven directories under `src/__tests__/fixtures/graphql/`, each with the schema above and a `pact.json` whose single interaction is as described:

| Directory | Interaction | Expected outcome |
|---|---|---|
| `valid-subset` | `POST /graphql`, body `{"query":"query GetProduct($id: ID!) { product(id: $id) { id name } }","variables":{"id":"10"}}`, response 200 `{"data":{"product":{"id":"10","name":"n"}}}` | `graphql.operation.matched` (R10) |
| `response-omits-selected-field` | same query, response `{"data":{"product":{"id":"10"}}}` | `graphql.operation.matched` (P7) |
| `request-unknown-field` | query `{ product(id: "1") { id stockLevel } }` | `request.graphql.field.unknown` (R4) |
| `request-missing-argument` | query `{ product { id } }` | `request.graphql.argument.missing` (R6) |
| `request-variable-type-mismatch` | query `query Q($status: ProductStatus!) { products(status: $status) { id } }`, variables `{"status":"PENDING"}` | `request.graphql.variables.incompatible` (R8) |
| `response-extra-field` | query `{ product(id: "1") { id } }`, response `{"data":{"product":{"id":"1","name":"n"}}}` | `response.graphql.body.incompatible` (P1) |
| `response-invalid-enum` | query `{ product(id: "1") { status } }`, response `{"data":{"product":{"status":"PENDING"}}}` | `response.graphql.body.incompatible` (P3) |
| `response-null-non-null-field` | query `{ product(id: "1") { id } }`, response `{"data":{"product":{"id":null}}}` | `response.graphql.body.incompatible` (P4) |
| `response-with-errors` | query `{ product(id: "1") { id } }`, response `{"errors":[{"message":"boom"}],"data":null}` | `response.graphql.errors.unvalidatable` warning (U1) |
| `response-custom-scalar` | query `{ product(id: "1") { createdAt } }`, response `{"data":{"product":{"createdAt":"2026-01-01T00:00:00Z"}}}` | `response.graphql.scalar.unvalidatable` warning (U3) |
| `union-with-fragments` | query `{ search(text: "x") { ... on Product { name } ... on Category { slug } } }`, response `{"data":{"search":[{"name":"n"},{"slug":"s"}]}}` | `graphql.operation.matched` (P5) |

Concretely, `valid-subset/pact.json`:

```json
{
  "consumer": { "name": "product-consumer" },
  "provider": { "name": "product-provider" },
  "metadata": { "pactSpecification": { "version": "4.0" } },
  "interactions": [
    {
      "type": "Synchronous/HTTP",
      "description": "a GraphQL product request",
      "providerStates": [{ "name": "a product with ID 10 exists" }],
      "request": {
        "method": "POST",
        "path": "/graphql",
        "headers": { "content-type": ["application/graphql"] },
        "body": {
          "contentType": "application/graphql",
          "encoded": false,
          "content": {
            "operationName": "GetProduct",
            "query": "query GetProduct($id: ID!) { product(id: $id) { id name } }",
            "variables": { "id": "10" }
          }
        }
      },
      "response": {
        "status": 200,
        "headers": { "content-type": ["application/json"] },
        "body": {
          "contentType": "application/json",
          "encoded": false,
          "content": { "data": { "product": { "id": "10", "name": "product name" } } }
        }
      }
    }
  ]
}
```

The other ten follow the same envelope with the query, variables, and response content swapped per the table.

- [ ] **Step 4: Add a misclassification guard fixture**

Create `src/__tests__/fixtures/graphql/rest-with-query-field/` containing the schema above plus a pact whose single interaction is `POST /search` with body `{"query":"SELECT * FROM products"}` and response 200 `{}`. Because no OAS is supplied and the interaction must classify as `http`, the expected `results.json` is `[]` — proving the heuristic did not misfire.

- [ ] **Step 5: Generate the snapshots**

Run: `npx vitest run src/__tests__/index.test.ts -u`

This writes each `results.json`. **Read every generated file** and confirm the codes match the "Expected outcome" column. A snapshot that records wrong behaviour is worse than no test.

- [ ] **Step 6: Re-run without `-u` to confirm they are stable**

Run: `npx vitest run src/__tests__/index.test.ts`
Expected: PASS, no snapshot writes.

- [ ] **Step 7: Commit**

```bash
git add src/__tests__/index.test.ts src/__tests__/fixtures/graphql
git commit -m "test: add end-to-end graphql comparison fixtures"
```

---

### Task 12: Schema provenance diagnostics (S1–S3)

**Files:**
- Create: `src/compare/graphql/schemaProvenance.ts`
- Create: `src/compare/graphql/schemaProvenance.test.ts`
- Modify: `src/compare/index.ts`
- Modify: `src/compare/graphql/index.ts`

**Interfaces:**
- Consumes: `fingerprint` from `#documents/graphql`
- Produces:
  ```ts
  interface ProvenanceState { reported: boolean; providerFingerprint?: string; }
  function* checkSchemaProvenance(
    state: ProvenanceState,
    providerSdl: string,
    interaction: GraphqlHttpInteraction,
    index: number,
  ): Iterable<Result>
  ```
  The state object is created once per `compare()` call so S1 fires once per pact, not once per interaction.

- [ ] **Step 1: Write the failing tests**

Create `src/compare/graphql/schemaProvenance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GraphqlHttpInteraction } from "#documents/pact";
import { checkSchemaProvenance } from "./schemaProvenance";

const PROVIDER_SDL = "type Query { product(id: ID!): Product }\ntype Product { id: ID! }";
const CONSUMER_SDL = "type Query { product(id: ID!): Product }\ntype Product { id: ID!, type: String }";

const interaction = (plugin?: GraphqlHttpInteraction["plugin"]): GraphqlHttpInteraction => ({
  _kind: "graphql-http",
  description: "an interaction",
  operation: { source: "plugin", document: "{ product(id: 1) { id } }", variables: {}, inconsistent: false },
  request: { method: "POST", path: "/graphql" },
  response: { status: 200 },
  plugin,
});

const run = (plugin?: GraphqlHttpInteraction["plugin"], state = { reported: false }) => [
  ...checkSchemaProvenance(state, PROVIDER_SDL, interaction(plugin), 0),
];

describe("checkSchemaProvenance", () => {
  it("says nothing when there is no embedded schema", () => {
    expect(run(undefined)).toEqual([]);
  });

  it("says nothing when the embedded schema matches", () => {
    expect(run({ inlineSchemaSdl: PROVIDER_SDL })).toEqual([]);
  });

  it("warns when the embedded schema differs (S1)", () => {
    const results = run({ inlineSchemaSdl: CONSUMER_SDL });
    expect(results.map((r) => r.code)).toEqual(["graphql.schema.mismatch"]);
    expect(results[0].type).toBe("warning");
  });

  it("warns only once per pact (S1)", () => {
    const state = { reported: false };
    expect(run({ inlineSchemaSdl: CONSUMER_SDL }, state)).toHaveLength(1);
    expect(run({ inlineSchemaSdl: CONSUMER_SDL }, state)).toHaveLength(0);
  });

  it("ignores an unparseable embedded schema rather than failing (S3)", () => {
    expect(run({ inlineSchemaSdl: "type Query {" })).toEqual([]);
  });

  it("never produces an error result (S3)", () => {
    const results = run({ inlineSchemaSdl: CONSUMER_SDL });
    expect(results.every((r) => r.type !== "error")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/compare/graphql/schemaProvenance.test.ts`
Expected: FAIL — cannot resolve `./schemaProvenance`.

- [ ] **Step 3: Implement**

Create `src/compare/graphql/schemaProvenance.ts`:

```ts
import { fingerprint } from "#documents/graphql";
import type { GraphqlHttpInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";

export interface ProvenanceState {
  reported: boolean;
  providerFingerprint?: string;
}

/**
 * S1: warn once per pact when the consumer was built against a different
 * schema. S3: this may never fail a comparison, so an embedded schema that
 * cannot be parsed is silently ignored rather than reported.
 */
export function* checkSchemaProvenance(
  state: ProvenanceState,
  providerSdl: string,
  interaction: GraphqlHttpInteraction,
  index: number,
): Iterable<Result> {
  if (state.reported) return;

  const embedded = interaction.plugin?.inlineSchemaSdl;
  if (!embedded) return;

  const consumerFingerprint = fingerprint(embedded);
  if (!consumerFingerprint) return;

  state.providerFingerprint ??= fingerprint(providerSdl);
  if (!state.providerFingerprint) return;
  if (state.providerFingerprint === consumerFingerprint) return;

  state.reported = true;
  yield {
    code: "graphql.schema.mismatch",
    message:
      "This consumer was built against a different version of the provider's GraphQL schema. This is not itself a compatibility failure, but it explains any that follow.",
    mockDetails: {
      ...baseMockDetails(interaction),
      location: `[root].interactions[${index}].pluginConfiguration.graphql.inline_schema`,
      value: consumerFingerprint,
    },
    specDetails: { location: "[root]", value: state.providerFingerprint },
    type: "warning",
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/compare/graphql/schemaProvenance.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire it in**

In `src/compare/graphql/index.ts`, change the signature and emit provenance first:

```ts
import { type ProvenanceState, checkSchemaProvenance } from "./schemaProvenance";

export function* compareGraphqlHttpInteraction(
  ajv: Ajv,
  schema: GraphQLSchema,
  providerSdl: string,
  provenance: ProvenanceState,
  interaction: GraphqlHttpInteraction,
  index: number,
): Iterable<Result> {
  yield* checkSchemaProvenance(provenance, providerSdl, interaction, index);

  const request = compareRequestOperation(schema, interaction, index);
  // ...rest unchanged
```

In `src/compare/index.ts`, store the SDL and reset provenance per pact:

```ts
  #graphql?: GraphQLSchema;
  #graphqlSdl?: string;
```

in the constructor:

```ts
    if (options.graphql) {
      this.#graphql = parseGraphqlSchema(options.graphql);
      this.#graphqlSdl = options.graphql;
    }
```

at the top of `compare()`, beside the existing `this.#resolvedMessages = new Map();`:

```ts
    const provenance: ProvenanceState = { reported: false };
```

and in the case:

```ts
        case "graphql-http":
          if (!this.#graphql || !this.#graphqlSdl) break;
          yield* compareGraphqlHttpInteraction(
            this.#ajvNocoerce,
            this.#graphql,
            this.#graphqlSdl,
            provenance,
            interaction,
            index,
          );
          break;
```

- [ ] **Step 6: Add a fixture**

Create `src/__tests__/fixtures/graphql/schema-provenance-mismatch/` with the standard schema and a pact whose interaction is the `valid-subset` one plus a `pluginConfiguration` block whose `inline_schema.base64_sdl` is the base64 of the standard schema with one extra field added to `Product`. Generate the snapshot with `-u` and confirm the result list contains a `graphql.schema.mismatch` warning **and** `graphql.operation.matched` — proving S3.

- [ ] **Step 7: Run everything**

Run: `npm test -- --run && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/compare/graphql src/compare/index.ts src/__tests__/fixtures/graphql/schema-provenance-mismatch
git commit -m "feat: report graphql schema provenance as a non-gating diagnostic"
```

---

### Task 12b: Explain request failures using the embedded schema (S2)

When a request-side check fails and the consumer embedded the schema it was built against, say *what changed* instead of just "unknown field". This never changes a verdict (S3) — it attaches a `cause` to an existing error.

**Files:**
- Modify: `src/compare/graphql/schemaProvenance.ts`
- Modify: `src/compare/graphql/schemaProvenance.test.ts`
- Modify: `src/compare/graphql/index.ts`

**Interfaces:**
- Consumes: `parse` from `#documents/graphql`
- Produces:
  ```ts
  function explainWithEmbeddedSchema(
    results: Result[],
    embeddedSdl: string | undefined,
    providerSchema: GraphQLSchema,
  ): Result[]
  ```
  Returns the same results, with a `causes` entry added to those it can explain.

- [ ] **Step 1: Write the failing tests**

Append to `src/compare/graphql/schemaProvenance.test.ts`:

```ts
import { parse as parseSchema } from "#documents/graphql";
import { explainWithEmbeddedSchema } from "./schemaProvenance";
import type { Result } from "#results/index";

const provider = parseSchema("type Query { product(id: ID!): Product }\ntype Product { id: ID! }");
const embedded = "type Query { product(id: ID!): Product }\ntype Product { id: ID!, type: String }";

const unknownField = (): Result => ({
  code: "request.graphql.field.unknown",
  message: 'Cannot query field "type" on type "Product". (line 1, column 20)',
  type: "error",
});

describe("explainWithEmbeddedSchema", () => {
  it("explains a field the consumer's schema had and the provider does not (S2)", () => {
    const [result] = explainWithEmbeddedSchema([unknownField()], embedded, provider);
    expect(result.causes).toHaveLength(1);
    expect(result.causes?.[0].message).toContain("Product.type");
    expect(result.causes?.[0].type).toBe("warning");
  });

  it("adds nothing when there is no embedded schema", () => {
    expect(explainWithEmbeddedSchema([unknownField()], undefined, provider)[0].causes)
      .toBeUndefined();
  });

  it("adds nothing when the embedded schema also lacks the field", () => {
    const same = "type Query { product(id: ID!): Product }\ntype Product { id: ID! }";
    expect(explainWithEmbeddedSchema([unknownField()], same, provider)[0].causes)
      .toBeUndefined();
  });

  it("adds nothing when the embedded schema cannot be parsed (S3)", () => {
    expect(explainWithEmbeddedSchema([unknownField()], "type Query {", provider)[0].causes)
      .toBeUndefined();
  });

  it("never turns a warning into an error (S3)", () => {
    const warning: Result = { code: "graphql.schema.mismatch", message: "m", type: "warning" };
    const [result] = explainWithEmbeddedSchema([warning], embedded, provider);
    expect(result.type).toBe("warning");
  });

  it("leaves results it cannot explain untouched", () => {
    const other: Result = {
      code: "request.graphql.incompatible",
      message: "something unparseable",
      type: "error",
    };
    expect(explainWithEmbeddedSchema([other], embedded, provider)[0].causes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/compare/graphql/schemaProvenance.test.ts`
Expected: FAIL — `explainWithEmbeddedSchema` is not exported.

- [ ] **Step 3: Implement**

Append to `src/compare/graphql/schemaProvenance.ts`:

```ts
import { type GraphQLSchema, isObjectType } from "graphql";
import { parse as parseSchemaSdl } from "#documents/graphql";

/**
 * S2: when a request-side error names a field and a type, and the consumer's
 * embedded schema had that field while the provider's does not, say so. This
 * only ever adds a `causes` entry to an existing result (S3).
 */
export const explainWithEmbeddedSchema = (
  results: Result[],
  embeddedSdl: string | undefined,
  providerSchema: GraphQLSchema,
): Result[] => {
  if (!embeddedSdl) return results;

  let embedded: GraphQLSchema;
  try {
    embedded = parseSchemaSdl(embeddedSdl);
  } catch {
    return results; // diagnostic input may never break a comparison
  }

  return results.map((result) => {
    const match = /Cannot query field "([^"]+)" on type "([^"]+)"/.exec(
      result.message,
    );
    if (!match) return result;

    const [, fieldName, typeName] = match;

    const embeddedType = embedded.getType(typeName);
    const providerType = providerSchema.getType(typeName);
    if (!isObjectType(embeddedType)) return result;
    if (!(fieldName in embeddedType.getFields())) return result;
    if (isObjectType(providerType) && fieldName in providerType.getFields()) {
      return result;
    }

    return {
      ...result,
      causes: [
        ...(result.causes ?? []),
        {
          code: "graphql.schema.mismatch" as const,
          message: `${typeName}.${fieldName} exists in the schema this consumer was built against and is absent from the provider contract`,
          type: "warning" as const,
        },
      ],
    };
  });
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/compare/graphql/schemaProvenance.test.ts`
Expected: PASS (12 tests — 6 from Task 12, 6 new).

- [ ] **Step 5: Wire it into the orchestrator**

In `src/compare/graphql/index.ts`, pass the request results through the explainer:

```ts
import { explainWithEmbeddedSchema } from "./schemaProvenance";
```

```ts
  const request = compareRequestOperation(schema, interaction, index);
  yield* explainWithEmbeddedSchema(
    request.results,
    interaction.plugin?.inlineSchemaSdl,
    schema,
  );
```

- [ ] **Step 6: Add a fixture**

Create `src/__tests__/fixtures/graphql/schema-provenance-explains-failure/`: the standard schema, and a pact whose query selects a field that exists **only** in the base64 embedded schema. Generate with `-u`; confirm the snapshot shows a `request.graphql.field.unknown` error carrying a `causes` entry that names the field.

- [ ] **Step 7: Run everything**

Run: `npm test -- --run && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/compare/graphql src/__tests__/fixtures/graphql/schema-provenance-explains-failure
git commit -m "feat: explain graphql request failures using the consumer's embedded schema"
```

---

### Task 13: Subscriptions as messages

**Files:**
- Modify: `src/documents/pact.ts`
- Create: `src/compare/graphql/subscriptionMessage.ts`
- Create: `src/compare/graphql/subscriptionMessage.test.ts`
- Modify: `src/compare/index.ts`
- Create: `src/__tests__/fixtures/graphql/subscription-message/`

**Interfaces:**
- Consumes: `graphqlResponseSchema`, the classification helpers from Task 7
- Produces:
  ```ts
  interface GraphqlMessageInteraction {
    _kind: "graphql-message";
    description?: string;
    providerState?: string;
    operation: GraphqlOperation;
    payload: unknown;      // the recorded message contents
    plugin?: GraphqlPluginConfig;
  }
  function* compareGraphqlMessageInteraction(
    ajv: Ajv, schema: GraphQLSchema, interaction: GraphqlMessageInteraction, index: number,
  ): Iterable<Result>
  ```

- [ ] **Step 1: Write the failing classification test**

Append to `src/documents/pact.test.ts`:

```ts
const SUBSCRIPTION = "subscription InventoryChanged($variantId: ID!) { inventoryChanged(variantId: $variantId) { quantity } }";

describe("graphql message classification", () => {
  it("classifies an async message carrying graphql plugin config", () => {
    const { interactions } = parse({
      metadata: { pactSpecification: { version: "4.0" } },
      interactions: [
        {
          type: "Asynchronous/Messages",
          description: "an inventory change message",
          pluginConfiguration: {
            graphql: {
              query_document: SUBSCRIPTION,
              operation_name: "InventoryChanged",
              variables_json: '{"variantId":"var-1"}',
            },
          },
          contents: {
            encoded: false,
            content: {
              subscription: "InventoryChanged",
              variables: { variantId: "var-1" },
              data: { inventoryChanged: { quantity: 42 } },
            },
          },
        },
      ],
    }) as any;

    const i = interactions[0];
    expect(i._kind).toBe("graphql-message");
    expect(i.operation.document).toBe(SUBSCRIPTION);
    expect(i.payload).toEqual({ data: { inventoryChanged: { quantity: 42 } } });
  });

  it("leaves a plain async message alone", () => {
    const { interactions } = parse({
      metadata: { pactSpecification: { version: "4.0" } },
      interactions: [
        { type: "Asynchronous/Messages", contents: { encoded: false, content: { a: 1 } } },
      ],
    }) as any;
    expect(interactions[0]._kind).toBe("async");
  });
});
```

Note `payload` is normalised to a GraphQL response envelope (`{data: …}`) so the same projection and comparison code serves both HTTP and messages.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/documents/pact.test.ts`
Expected: FAIL — `_kind` is `"async"`.

- [ ] **Step 3: Implement classification**

In `src/documents/pact.ts`, add the type:

```ts
export interface GraphqlMessageInteraction {
  _kind: "graphql-message";
  description?: string;
  providerState?: string;
  operation: GraphqlOperation;
  /** Normalised to a GraphQL response envelope: `{ data: … }`. */
  payload: unknown;
  plugin?: GraphqlPluginConfig;
}
```

Add it to the `Interaction` union, then add:

```ts
const asGraphqlMessageInteraction = (
  i: RawInteraction,
): GraphqlMessageInteraction | undefined => {
  const pluginConfig = i.pluginConfiguration?.graphql;
  const document = pluginConfig?.query_document;
  // There is no non-plugin convention for GraphQL subscription messages, so
  // no heuristic applies here (requirements section 4).
  if (!document) return undefined;

  const contents = parseAsPactV4Body(i.contents) as
    | { subscription?: string; variables?: Record<string, unknown>; data?: unknown }
    | undefined;

  const inlineSchemaSdl = decodeBase64(pluginConfig?.inline_schema?.base64_sdl);
  const schemaHash = pluginConfig?.schema_ref?.hash;

  return {
    _kind: "graphql-message",
    description: i.description,
    providerState: i.providerState,
    operation: {
      source: "plugin",
      document,
      operationName: pluginConfig?.operation_name ?? contents?.subscription,
      variables: parseJsonObject(pluginConfig?.variables_json),
      inconsistent: false,
    },
    payload: contents ? { data: contents.data } : undefined,
    plugin:
      inlineSchemaSdl || schemaHash ? { inlineSchemaSdl, schemaHash } : undefined,
  };
};
```

and in `parse()`:

```ts
      if (isAsyncInteraction(i)) {
        return asGraphqlMessageInteraction(i) ?? parseAsyncInteraction(i);
      }
```

- [ ] **Step 4: Run to verify classification passes**

Run: `npx vitest run src/documents/pact.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing comparison test**

Create `src/compare/graphql/subscriptionMessage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { setupAjv } from "#compare/setup";
import { parse as parseSchema } from "#documents/graphql";
import type { GraphqlMessageInteraction } from "#documents/pact";
import { compareGraphqlMessageInteraction } from "./subscriptionMessage";

const ajv = setupAjv({ allErrors: true, coerceTypes: false, strictSchema: false, logger: false });

const schema = parseSchema(`
  type Inventory { quantity: Int!, updatedAt: String! }
  type Query { placeholder: String }
  type Subscription { inventoryChanged(variantId: ID!): Inventory! }
`);

const DOC = "subscription S($variantId: ID!) { inventoryChanged(variantId: $variantId) { quantity } }";

const interaction = (payload: unknown): GraphqlMessageInteraction => ({
  _kind: "graphql-message",
  description: "an inventory message",
  operation: { source: "plugin", document: DOC, operationName: "S", variables: { variantId: "v1" }, inconsistent: false },
  payload,
});

const run = (payload: unknown) => [
  ...compareGraphqlMessageInteraction(ajv, schema, interaction(payload), 0),
];

describe("compareGraphqlMessageInteraction", () => {
  it("matches a compatible subscription payload", () => {
    expect(run({ data: { inventoryChanged: { quantity: 42 } } }).map((r) => r.code)).toEqual([
      "graphql.operation.matched",
    ]);
  });

  it("allows an omitted field (P7)", () => {
    expect(run({ data: { inventoryChanged: {} } }).map((r) => r.code)).toEqual([
      "graphql.operation.matched",
    ]);
  });

  it("rejects a field that was never selected (P1)", () => {
    expect(
      run({ data: { inventoryChanged: { quantity: 1, updatedAt: "x" } } }).map((r) => r.code),
    ).toEqual(["message.graphql.payload.incompatible"]);
  });

  it("rejects a scalar of the wrong type (P2)", () => {
    expect(run({ data: { inventoryChanged: { quantity: "lots" } } }).map((r) => r.code)).toEqual([
      "message.graphql.payload.incompatible",
    ]);
  });

  it("rejects a subscription field the schema does not have (R4)", () => {
    const i = interaction({ data: {} });
    i.operation.document = "subscription S { nope { id } }";
    expect([...compareGraphqlMessageInteraction(ajv, schema, i, 0)].map((r) => r.code)).toEqual([
      "request.graphql.field.unknown",
    ]);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/compare/graphql/subscriptionMessage.test.ts`
Expected: FAIL — cannot resolve `./subscriptionMessage`.

- [ ] **Step 7: Implement the comparison**

Create `src/compare/graphql/subscriptionMessage.ts`:

```ts
import type Ajv from "ajv/dist/2019";
import { type GraphQLSchema, parse as parseDocument, validate } from "graphql";
import { ProjectionError, selectOperation } from "#documents/graphqlProjection";
import type { GraphqlMessageInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import {
  baseMockDetails,
  formatInstancePath,
  formatMessage,
} from "#results/index";
import { graphqlResponseSchema } from "#transform/graphqlResponseSchema";

export function* compareGraphqlMessageInteraction(
  ajv: Ajv,
  schema: GraphQLSchema,
  interaction: GraphqlMessageInteraction,
  index: number,
): Iterable<Result> {
  const documentLocation = `[root].interactions[${index}].pluginConfiguration.graphql.query_document`;
  const payloadLocation = `[root].interactions[${index}].contents.content.data`;
  const mock = (location: string, value: unknown) => ({
    ...baseMockDetails(interaction),
    location,
    value,
  });

  let document;
  try {
    document = parseDocument(interaction.operation.document);
    selectOperation(document, interaction.operation.operationName);
  } catch (e) {
    yield {
      code:
        e instanceof ProjectionError
          ? "request.graphql.operation.unknown"
          : "request.graphql.document.invalid",
      message: (e as Error).message,
      mockDetails: mock(documentLocation, interaction.operation.document),
      specDetails: { location: "[root]", value: undefined },
      type: "error",
    };
    return;
  }

  const validationErrors = validate(schema, document);
  if (validationErrors.length) {
    for (const error of validationErrors) {
      yield {
        code: /^Cannot query field /.test(error.message)
          ? "request.graphql.field.unknown"
          : "request.graphql.incompatible",
        message: error.message,
        mockDetails: mock(documentLocation, interaction.operation.document),
        specDetails: { location: "[root].Subscription", value: undefined },
        type: "error",
      };
    }
    return;
  }

  if (interaction.payload === undefined) return;

  const { schema: responseSchema, unvalidatableScalars } = graphqlResponseSchema(
    schema,
    document,
    interaction.operation.operationName,
  );

  for (const path of unvalidatableScalars) {
    yield {
      code: "response.graphql.scalar.unvalidatable",
      message: `Custom scalar at ${path} cannot be validated; any value is accepted`,
      mockDetails: mock(`${payloadLocation}`, undefined),
      specDetails: { location: "[root].Subscription", value: undefined },
      type: "warning",
    };
  }

  const validateFn = ajv.compile(responseSchema);
  if (validateFn(interaction.payload)) {
    yield {
      code: "graphql.operation.matched",
      message: `Matched GraphQL subscription ${interaction.operation.operationName ?? "(anonymous)"}`,
      specDetails: { location: "[root].Subscription", value: undefined },
      type: "info",
    };
    return;
  }

  for (const error of validateFn.errors ?? []) {
    yield {
      code: "message.graphql.payload.incompatible",
      message: `Message payload is incompatible with the GraphQL schema: ${formatMessage(error)}`,
      mockDetails: mock(
        `${payloadLocation}${formatInstancePath(error)}`,
        interaction.payload,
      ),
      specDetails: { location: "[root].Subscription", value: undefined },
      type: "error",
    };
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/compare/graphql/subscriptionMessage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Route it**

In `src/compare/index.ts` add the import and the case:

```ts
import { compareGraphqlMessageInteraction } from "#compare/graphql/subscriptionMessage";
```

```ts
        case "graphql-message":
          if (!this.#graphql) break;
          yield* compareGraphqlMessageInteraction(
            this.#ajvNocoerce,
            this.#graphql,
            interaction,
            index,
          );
          break;
```

- [ ] **Step 10: Add the fixture**

Create `src/__tests__/fixtures/graphql/subscription-message/` with a schema containing a `Subscription` type and a pact whose single `Asynchronous/Messages` interaction carries `pluginConfiguration.graphql.query_document` and `contents.content = {subscription, variables, data}`. Generate with `-u` and confirm the snapshot records `graphql.operation.matched`.

- [ ] **Step 11: Run everything**

Run: `npm test -- --run && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 12: Commit**

```bash
git add src/documents/pact.ts src/documents/pact.test.ts src/compare/graphql src/compare/index.ts src/__tests__/fixtures/graphql/subscription-message
git commit -m "feat: compare graphql subscription messages against the schema"
```

---

### Task 14: CLI support

**Files:**
- Modify: `src/cli/runner.ts`
- Modify: `src/cli.ts`
- Modify: `src/cli/runner.test.ts`

**Interfaces:**
- Consumes: `ComparatorOptions.graphql`
- Produces: `SpecPaths.graphqlPath`, `ComparatorDocs.graphql`, and the `--graphql` flag

- [ ] **Step 1: Write the failing test**

Append to `src/cli/runner.test.ts`:

```ts
it("reads a graphql schema as raw text, not as YAML or JSON", async () => {
  const SDL = "type Query { product(id: ID!): Product }\ntype Product { id: ID! }";
  let received: unknown;

  const runner = new Runner({
    readFile: async (p: string) =>
      p === "schema.graphql"
        ? SDL
        : JSON.stringify({ metadata: { pactSpecification: { version: "4.0" } }, interactions: [] }),
    output: () => {},
    createComparator: (docs) => {
      received = docs.graphql;
      return { async *compare() {} };
    },
  });

  await runner.run({ graphqlPath: "schema.graphql" }, ["pact.json"]);
  expect(received).toBe(SDL);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/cli/runner.test.ts`
Expected: FAIL — `graphqlPath` is not a valid `SpecPaths` key.

- [ ] **Step 3: Implement**

In `src/cli/runner.ts`:

```ts
export interface SpecPaths {
  oasPath?: string;
  asyncapiPath?: string;
  graphqlPath?: string;
}

export interface ComparatorDocs {
  oas?: OASDocument;
  asyncapi?: AsyncAPIDocument;
  graphql?: string;
}
```

In `run()`, alongside the existing loaders:

```ts
    if (specPaths.graphqlPath) {
      // SDL is neither JSON nor YAML, so it is read verbatim.
      docs.graphql = await this.readContent(specPaths.graphqlPath);
    }
```

`readContent` is currently `private`; it already handles both file paths and URLs, so no change is needed beyond calling it.

- [ ] **Step 4: Add the CLI flag**

In `src/cli.ts`:

```ts
  .option("--graphql <path>", "path or URL to GraphQL schema (SDL) file")
```

Update the guard and the description:

```ts
      if (!options.oas && !options.asyncapi && !options.graphql) {
        console.error(
          "Error: at least one of --oas, --asyncapi or --graphql must be provided",
        );
        process.exit(1);
      }
      const runner = new Runner();
      const exitCode = await runner.run(
        {
          oasPath: options.oas,
          asyncapiPath: options.asyncapi,
          graphqlPath: options.graphql,
        },
        pactPaths,
      );
```

Also update the `.description()` text from "Compares an OpenAPI or AsyncAPI spec" to "Compares an OpenAPI, AsyncAPI or GraphQL spec", and widen the `options` parameter type to `{ oas?: string; asyncapi?: string; graphql?: string }`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/cli src/__tests__/cli.test.ts && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/cli/runner.ts src/cli/runner.test.ts
git commit -m "feat: add --graphql flag to the cli"
```

---

### Task 15: Documentation and release

**Files:**
- Modify: `README.md`
- Create: `.changeset/graphql-bdct.md`

- [ ] **Step 1: Document the feature in the README**

Add a `## GraphQL` section after the existing usage documentation:

````markdown
## GraphQL

A GraphQL schema can be used as the provider contract. Pass the SDL as text:

```js
import { readFileSync } from "node:fs";
import { Comparator } from "@pactflow/openapi-pact-comparator";

const comparator = new Comparator({
  graphql: readFileSync("schema.graphql", "utf-8"),
});

for await (const result of comparator.compare(pact)) {
  console.log(result);
}
```

or from the CLI:

```
opc --graphql schema.graphql pact.json
```

An interaction is compared as GraphQL when it carries a `pluginConfiguration.graphql`
block (written by [pact-graphql-plugin](https://github.com/mefellows/pact-graphql-plugin)),
declares an `application/graphql` content type, or is a `POST` whose body is a
GraphQL envelope. Hand-rolled GraphQL pacts therefore work without the plugin.

Compatibility means the consumer's operation is valid against the provider's
schema, and its recorded response contains nothing the provider could not
return. The consumer may select fewer fields than the schema offers, and may
omit any field from its recorded response — including one the schema declares
non-null. See
[the requirements document](docs/superpowers/specs/2026-09-10-graphql-bdct-requirements.md)
for the full rules.
````

- [ ] **Step 2: Add a changeset**

Create `.changeset/graphql-bdct.md`:

```markdown
---
"@pactflow/openapi-pact-comparator": minor
---

Add GraphQL support. A GraphQL schema (SDL) can now be used as the provider
contract via the `graphql` option or the `--graphql` CLI flag. Queries,
mutations and subscription messages are compared against the schema: the
consumer's operation must be valid against it, and the recorded response must
contain nothing the provider could not return, while remaining free to select
and record fewer fields.
```

- [ ] **Step 3: Full verification**

Run: `npm test -- --run && npm run typecheck && npm run lint && npm run prettier && npm run smoke:graphql`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add README.md .changeset/graphql-bdct.md
git commit -m "docs: document graphql support and add changeset"
```

---

## Self-Review Notes

**Spec coverage.** Every requirement maps to a task: R1–R9 → Task 8; R10 → Tasks 3 and 11; P1–P8 → Tasks 3, 4, 5, 9; U1–U4 → Task 9; requirements §4 classification → Task 7; §4.1 inconsistency → Tasks 7 and 8; §5 mixed pacts and silent skip → Task 10; S1 and S3 → Task 12; S2 → Task 12b; subscriptions → Task 13. Design §3 interface → Tasks 10 and 14; §11 bundling risk → Task 1.

**Known gap, deliberate.** The design mentions caching compiled AJV validators on a digest of the operation document. No task implements it: correctness comes first, and `ajv.compile` is already memoised internally by AJV for structurally identical schemas. Add it only if a benchmark shows it matters.
