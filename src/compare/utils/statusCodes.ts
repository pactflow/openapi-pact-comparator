export const genericCode = (status: number): string =>
  `${Math.floor(status / 100)}XX`;
