export const pct = (share: number): string => `${Math.round(share * 100)}%`;
export const num = (n: number): string => Math.round(n).toLocaleString('en-US');
