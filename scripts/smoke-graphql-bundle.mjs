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
    throw new Error(
      `${label}: expected a Query root type, got ${queryType?.name}`,
    );
  }
  console.log(`${label}: ok`);
};

const require = createRequire(import.meta.url);
check("dist/index.cjs", require("../dist/index.cjs").parseGraphqlSchema);
check("dist/index.mjs", (await import("../dist/index.mjs")).parseGraphqlSchema);
console.log("graphql bundle smoke test passed");
