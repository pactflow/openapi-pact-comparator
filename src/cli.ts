#!/usr/bin/env node

import { program } from "commander";
import packageJson from "../package.json";
import { Runner } from "./cli/runner";

program
  .version(packageJson.version)
  .command("opc")
  .description(
    `Compares an OpenAPI, AsyncAPI or GraphQL spec against one or more Pact files.

Comparison output is presented as ND-JSON, with one line per Pact file.

The exit code equals the number of Pact files with errors (not the number of errors in one comparison).`,
  )
  .option("--oas <path>", "path or URL to OpenAPI (OAS) file")
  .option("--asyncapi <path>", "path or URL to AsyncAPI file")
  .option("--graphql <path>", "path or URL to GraphQL schema (SDL) file")
  .argument("<pact...>", "path(s) or URL(s) to Pact file(s)")
  .action(
    async (
      pactPaths: string[],
      options: { oas?: string; asyncapi?: string; graphql?: string },
    ) => {
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
      process.exit(exitCode);
    },
  )
  .parse(process.argv);
