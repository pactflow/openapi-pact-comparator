# Worked examples

Acceptance fixtures for Avro and Protobuf payloads. An Order Service publishes
`OrderCreated` to Kafka; two consumers were built against v1:

- **NotificationsService** uses almost every field.
- **AnalyticsService** uses only `status` and `items[].{sku, quantity}` (for
  Avro, via a projection reader schema).

The pacts were written by the real plugins (pact-protobuf-plugin 0.8.0,
pact-avro-plugin 0.1.3). The Protobuf pacts embed a `.proto` that imports
`google/protobuf/timestamp.proto`. Each change in `workedExample.test.ts` is
applied to v1 in isolation, and `orders.v2.proto` / `order-created.v2.avsc`
combine them. Changes B1–B8 (Protobuf) and A1–A7 (Avro) break a consumer at
runtime; N-changes don't.
