export function landingNav(payload: unknown, now = Date.now()) {
  if (!payload || typeof payload !== "object") return null;
  const { nav_per_token: nav, timestamp } = payload as Record<string, unknown>;
  if (
    typeof nav !== "string" ||
    !/^\d+(\.\d+)?$/.test(nav) ||
    !Number.isFinite(Number(nav)) ||
    Number(nav) <= 0 ||
    typeof timestamp !== "string"
  )
    return null;
  const age = now - Date.parse(timestamp);
  if (!Number.isFinite(age) || age < 0 || age > 48 * 3600_000) return null;
  const minutes = Math.floor(age / 60_000);
  const hours = Math.floor(minutes / 60);
  const relative =
    minutes < 1
      ? "just now"
      : hours < 1
        ? `${minutes} min ago`
        : `${hours} h ago`;
  return {
    value: Number(nav).toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    }),
    timestamp,
    relative,
  };
}
