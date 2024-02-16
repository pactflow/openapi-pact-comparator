# OpenAPI-Pact-Comparator

## What is this?

This repo compares OpenAPI schemas and Pact contracts to determine if they are
compatible.

## What about `swagger-mock-validator`?

SWM is no longer developed by Atlassian and maintenance is token over by
PactFlow. However, the codebase is dated, and is very convoluted for what it is
doing.

It is also very slow due to its inefficient use of `ajv`; schemas are
unnecessarily recompiled for every interaction with no reuse.

## How is this better?

Schemas are compiled once, and reused where possible. For the same operation,
the schema reuse is approximately 40x faster.

Further, instead of iterating through an array of routes, we use [Radix
Tree](https://en.wikipedia.org/wiki/Radix_tree) search using `find-my-way`.
This allows large providers to be traversed quickly.

Finally, computation is written in Javascript async generators, which allows
large comparisons to be broken down into smaller units. The resulting smaller
event loop delay allows the comparator to be used in a multi-comparison
environment without blocking, suitable for say, a micro-service server.
