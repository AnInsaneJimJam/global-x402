// Per-merchant knowledge for verifying order-confirmation emails. Each merchant file
// supplies its DKIM signing domains and how to read order facts from the email text.
export type ExtractedOrder = {
  merchantOrderId: string | null;
  quantity: number | null;
  total: { currency: string; minor: string } | null;
};
export type MerchantConfig = {
  id: string;
  dkimDomains: readonly string[];
  extract(text: string): ExtractedOrder;
};

// "1,234.50" -> "123450". Currencies in scope (INR, SGD, USD) all use two decimals.
export function toMinor(amount: string): string {
  const match = /^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/.exec(amount.trim());
  if (!match) throw new Error(`Unrecognised amount: ${amount}`);
  return BigInt(match[1]!.replaceAll(',', '') + match[2]!).toString();
}
