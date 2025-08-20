export const patternedStatus = (status: number): string =>
  `${Math.floor(status / 100)}XX`;
