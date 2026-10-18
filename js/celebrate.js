// Chapter-complete celebration: a short burst of confetti on a canvas.
// The checkmark itself is an SVG animated in CSS (see .celebrate-check).

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function confetti(canvas) {
  if (reduceMotion()) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const styles = getComputedStyle(document.documentElement);
  const colors = ["--gold", "--gold-soft", "--ink", "--sky"].map((v) => styles.getPropertyValue(v).trim());

  const pieces = Array.from({ length: 140 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const speed = 7 + Math.random() * 9;
    return {
      x: width / 2,
      y: height * 0.55,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: Math.random() < 0.3 ? "star" : "rect",
    };
  });

  const start = performance.now();
  const duration = 2600;

  function star(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 ? r * 0.4 : r;
      const a = (i * Math.PI) / 4;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - duration * 0.6) / (duration * 0.4));
    for (const p of pieces) {
      p.vy += 0.25;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "star") star(0, 0, p.size * 0.8);
      else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, width, height);
  }
  requestAnimationFrame(frame);
}
