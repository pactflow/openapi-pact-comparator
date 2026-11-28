---
"@pactflow/openapi-pact-comparator": minor
---

Compare an AsyncAPI message interaction's `destination` metadata with the
channel of the operation it references, using the matching rules of the
channel's protocol (NATS subjects, Kafka topics, RabbitMQ exchanges, queues and
routing keys).

| Code                                | Type    | Meaning                                                |
| ----------------------------------- | ------- | ------------------------------------------------------ |
| `message.destination.incompatible`  | error   | The destination does not match the channel             |
| `message.destination.unvalidatable` | warning | The destination could not be compared with the channel |
