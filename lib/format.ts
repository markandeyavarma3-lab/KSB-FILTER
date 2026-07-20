// Indian currency / number formatting (spec section 20).
export function inr(n: number | null | undefined): string {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}
export function num(n: number | null | undefined, d = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: d });
}
// HP / kW are catalogue ratings and must never be rounded: 7.5 stays 7.5,
// 12.5 stays 12.5, 1 stays 1. No thousands grouping (values are small).
export function hp(n: number | null | undefined): string {
  return n == null ? "—" : String(n);
}
