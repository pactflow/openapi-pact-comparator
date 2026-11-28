// Protocols without their own handler. `{parameter}` matches one or more
// characters other than `.` and `/`. An address containing a wildcard
// character is not compared.
import { segmentPattern } from "./tokens";
import type { DestinationProtocol } from "./types";

const WILDCARD_CHARACTERS = /[*>#+]/;

export const generic: DestinationProtocol = {
  protocols: [],
  check(destination, channel) {
    const { address } = channel;
    if (typeof address !== "string") {
      return { status: "skip" };
    }
    if (WILDCARD_CHARACTERS.test(address)) {
      return {
        status: "unvalidatable",
        reason:
          "the address contains wildcard characters, which have no defined meaning for the channel's protocol",
        spec: { location: ".address", value: address },
      };
    }
    return segmentPattern(address, "./").test(destination)
      ? { status: "match" }
      : {
          status: "mismatch",
          against: "the channel address",
          expected: address,
          spec: { location: ".address", value: address },
        };
  },
};
