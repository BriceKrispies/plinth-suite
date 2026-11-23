// Number and date formatting shared by every view (the same strings the Plat, the painter and the harness compare).

const nf = new Intl.NumberFormat("en-US");
export const fmt = (n: number): string => nf.format(n);
export const signed = (n: number): string => (n >= 0 ? `+${fmt(n)}` : `−${fmt(Math.abs(n))}`);
export const utc = (iso: string): string => {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
export const typeLabel = (t: string): string => t.replace(/_/g, " ");
