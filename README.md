# OpenAPI-Pact-Comparator

## What is this?

This compares OpenAPI schemas and Pact contracts to determine if they are
compatible. It is inspired by
[swagger-mock-validator](https://github.com/pactflow/swagger-mock-validator) and
aims to retain a mostly compatible interface.

## Why rewrite it?

[swagger-mock-validator](https://github.com/pactflow/swagger-mock-validator) has
aged, and is very difficult to extend and improve on.

It is also very slow primarily due to inefficient use of
[ajv](https://ajv.js.org/); schemas are unnecessarily recompiled everytime
instead of being cached.

## How is this better?

**Schemas are compiled once, and reused where possible**. In practical terms,
this gives us an improvement exceeding 20x in real-world comparisons. In some
cases, this was 50x faster!

**Referenced schemas are NOT inlined**. They are kept as references to keep the
size of complex schemas down. We need to do this anyway to support circular
references. Further, unused references are skipped to speed up schema
compilation in AJV.

**Multiple pacts can be compared in one invocation to maximise schema reuse**.
Instead of performing the comparison per pair of OAS + Pact, we can reuse the
compiled OAS schemas across multiple Pacts.

**A fast HTTP router is used to match provider routes**. Instead of iterating
through an array of routes, we use
[Radix Tree](https://en.wikipedia.org/wiki/Radix_tree) search using
[find-my-way](https://github.com/delvedor/find-my-way) This allows large
providers to be traversed quickly.

**Computation is broken up to small units using async generators**. This leads
to low event loop delays, suitable for high concurrency servers.

## Usage

With error handling omitted for brevity:

```
import { Comparator } from "openapi-pact-comparator";

// oas/asyncapi is object from JSON.parse() or yaml.load()
const comparator = new Comparator({ oas, asyncapi });

// pacts is array of objects the same way
for (const pact of pacts) {
  for await (const result of comparator.compare(pact)) {
    console.log(result);
  }
}
```

## Avro and Protobuf

Avro and Protobuf message payloads are supported for AsyncAPI, using Pact v4
files from `pact-avro-plugin` and `pact-protobuf-plugin`. Protobuf schemas must
be self-contained: `.proto` sources that `import` other files (including
well-known types such as `google/protobuf/timestamp.proto`) cannot be resolved,
and are reported as unsupported rather than compared.

Payloads are decoded to JavaScript numbers, which can only represent integers
exactly up to 2^53 (9,007,199,254,740,992). Beyond that:

- Protobuf `int64`, `uint64`, `sint64`, `fixed64` and `sfixed64` values are
  silently rounded to the nearest representable number. The comparison still
  runs, so a rounded value could pass or fail a check it would not have with the
  exact value.
- Avro `long` values are not decoded at all, and the message is reported as
  unvalidatable.

## Quirks mode

To retain compatibility with
[swagger-mock-validator](https://github.com/pactflow/swagger-mock-validator), an
environment variable `QUIRKS` can be set [to any value]. When this is true, all
of SMV quirks are reproduced in case you are unable to migrate immediately.

The quirks can also be enabled/disabled by adding to the `info` section of the
OAS some extensions in the form of `x-opc-config-${quirk-name}`, where quirks
are listed [here](./src/utils/config.ts).

This mode may be removed eventually, so you should always endeavour to try to
update your comparisons to use the latest functionality.
