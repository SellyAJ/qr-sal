// Geometry only: identical text on two separate physical symbols stays separate.
export function inside(point, corners) {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i],
      b = corners[(i + 1) % corners.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 1e-6) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return !!sign;
}

export function sameRegion(a, b) {
  const center = (corners) =>
    corners.reduce((p, q) => ({ x: p.x + q.x / 4, y: p.y + q.y / 4 }), {
      x: 0,
      y: 0,
    });
  const size = (corners) =>
    Math.min(
      ...corners.map((p, i) =>
        Math.hypot(p.x - corners[(i + 1) % 4].x, p.y - corners[(i + 1) % 4].y),
      ),
    );
  const ca = center(a.corners),
    cb = center(b.corners),
    sa = size(a.corners),
    sb = size(b.corners);
  return (
    Math.max(sa, sb) < Math.min(sa, sb) * 1.8 &&
    Math.hypot(ca.x - cb.x, ca.y - cb.y) < Math.min(sa, sb) * 0.25
  );
}

export function collectCode(codes, code, conflicts = null) {
  const previous = codes.find((other) => sameRegion(other, code));
  if (!previous) {
    codes.push(code);
    return true;
  }
  if (previous.text !== code.text) {
    // Retain contradictory independently validated readings for investigation.
    // Never silently select a convenient payload to improve the score.
    if (
      !codes.some(
        (other) => sameRegion(other, code) && other.text === code.text,
      )
    )
      codes.push(code);
    if (conflicts)
      conflicts.push({
        corners: code.corners,
        first: previous.text,
        second: code.text,
      });
  }
  return false;
}
