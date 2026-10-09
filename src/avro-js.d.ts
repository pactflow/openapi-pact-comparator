// avro-js ships no typings; declare only what we use.
declare module "avro-js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AvroType = any;
  const avro: {
    parse(schema: unknown): AvroType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    types: Record<string, any>;
  };
  export default avro;
}
