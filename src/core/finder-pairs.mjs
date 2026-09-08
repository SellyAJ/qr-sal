import { verifyProjectiveFinder } from './finder-geometry.mjs';

// Two observed finders can suggest where to LOOK for a third. A suggestion is
// accepted only after the source pixels pass the existing border/template check.
export function completeFinderPairs(
  bits,
  w,
  h,
  points,
  {
    deadline = Infinity,
    knownCodes = [],
    contains = () => false,
    audit = null,
  } = {},
) {
  const anchors = points
    .filter(
      (p) =>
        p.hits >= 2 &&
        p.quality >= 0.76 &&
        !knownCodes.some((c) => contains(p, c.corners)),
    )
    .sort((a, b) => b.quality * b.hits - a.quality * a.hits)
    .slice(0, 18);
  const found = [];
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++) {
      if (performance.now() > deadline) return found;
      const a = anchors[i],
        b = anchors[j],
        dx = b.x - a.x,
        dy = b.y - a.y,
        span = Math.hypot(dx, dy),
        moduleSize = (a.module + b.module) / 2;
      if (
        span < moduleSize * 9 ||
        span > moduleSize * 180 ||
        Math.max(a.module, b.module) > Math.min(a.module, b.module) * 1.8
      )
        continue;
      const angle = Math.atan2(dy, dx),
        guesses = [];
      for (const sign of [-1, 1]) {
        guesses.push({
          x: (a.x + b.x - sign * dy) / 2,
          y: (a.y + b.y + sign * dx) / 2,
          angle: angle - Math.PI / 4,
          kind: 'diagonal',
        });
        for (const p of [a, b])
          guesses.push({
            x: p.x - sign * dy,
            y: p.y + sign * dx,
            angle,
            kind: 'side',
          });
      }
      for (const guess of guesses) {
        if (performance.now() > deadline) return found;
        if (
          guess.x < moduleSize * 3 ||
          guess.y < moduleSize * 3 ||
          guess.x > w - moduleSize * 3 ||
          guess.y > h - moduleSize * 3
        )
          continue;
        if (
          [...anchors, ...found].some(
            (p) => Math.hypot(p.x - guess.x, p.y - guess.y) < moduleSize * 2,
          )
        )
          continue;
        if (knownCodes.some((c) => contains(guess, c.corners))) continue;
        const c = Math.cos(guess.angle),
          s = Math.sin(guess.angle),
          m = moduleSize * Math.max(Math.abs(c), Math.abs(s));
        let correct = 0;
        for (let y = -3; y <= 3; y++)
          for (let x = -3; x <= 3; x++) {
            const xx = Math.floor(guess.x + m * (x * c - y * s)),
              yy = Math.floor(guess.y + m * (x * s + y * c)),
              d = Math.max(Math.abs(x), Math.abs(y));
            if (
              xx >= 0 &&
              yy >= 0 &&
              xx < w &&
              yy < h &&
              bits[yy * w + xx] === (d === 3 || d <= 1 ? 1 : 0)
            )
              correct++;
          }
        if (correct < 36) continue;
        const candidate = {
            ...guess,
            module: moduleSize,
            hits: Math.min(a.hits, b.hits, 8),
          },
          verified = verifyProjectiveFinder(bits, w, h, candidate, {
            deadline,
          });
        if (audit)
          audit.push({ prediction: guess, templateMatches: correct, verified });
        if (!verified.accepted) continue;
        const center =
          verified.residualModules < 0.15 ? verified.center : guess;
        found.push({
          ...candidate,
          x: center.x,
          y: center.y,
          quality: verified.quality,
          pairVerified: true,
        });
        if (found.length >= 24) return found;
      }
    }
  return found;
}
