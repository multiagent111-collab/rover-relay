export function newestFirst<T extends { createdAt: string; id: string }>(
  a: T,
  b: T,
) {
  const time = (value: string) =>
    Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  return time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id);
}
