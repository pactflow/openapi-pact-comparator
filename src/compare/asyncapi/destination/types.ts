import type { Channel } from "#documents/asyncapi";

interface SpecValue {
  location: string;
  value: unknown;
}

export type DestinationCheck =
  | { status: "match" }
  | {
      status: "mismatch";
      against: string;
      expected: string;
      spec: SpecValue;
    }
  | { status: "unvalidatable"; reason: string; spec: SpecValue }
  | { status: "skip" };

export interface DestinationProtocol {
  protocols: string[];
  check(destination: string, channel: Channel): DestinationCheck;
}
