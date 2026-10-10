/** A Solana mint address: base58, 32–44 chars. */
export function isValidMint(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}
