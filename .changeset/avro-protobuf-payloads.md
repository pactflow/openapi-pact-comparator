---
"@pactflow/openapi-pact-comparator": minor
---

Support Avro and Protobuf message payloads: binary payloads in Pact v4 files
(from pact-avro-plugin and pact-protobuf-plugin) are decoded when parsing the
Pact, and Avro / Protobuf schemas in AsyncAPI documents are converted to JSON
Schema on demand, the first time a Pact interaction needs them.
