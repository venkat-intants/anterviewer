// HeroCinematic — the Superwhisper hero atmosphere recreated in code:
// a drifting aurora sky, a soft shadowed face-profile bleeding off the left
// (with a warm rim-light on the lit edge), an on-brand electric voice-waveform
// at the lips, and a sliver of a laptop edge catching light on the lower-right.
// All decorative, all pointer-events-none.

// Right-facing profile: crown → forehead → brow → nose → lips → chin → jaw →
// neck, with the bulk of the head/shoulder bleeding off the left & bottom edges.
const PROFILE =
  'M -120 -120 L 250 -120 ' +
  'C 326 -36, 376 92, 374 212 ' + // crown → forehead
  'C 374 252, 360 270, 360 292 ' + // forehead → brow
  'C 360 312, 352 322, 368 334 ' + // brow → nose bridge
  'C 396 356, 424 388, 412 408 ' + // nose ridge → tip
  'C 406 424, 372 418, 360 428 ' + // under nose
  'C 382 440, 382 456, 358 466 ' + // upper lip
  'C 376 476, 368 498, 344 506 ' + // lower lip
  'C 330 512, 342 528, 336 552 ' + // chin
  'C 330 596, 298 622, 274 642 ' + // jaw
  'C 256 658, 250 704, 242 754 ' + // neck
  'L 208 1120 L -120 1120 Z';

const BARS = [16, 34, 54, 26, 44, 20, 36, 14];

export default function HeroCinematic() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Aurora sky — black → navy → violet → lavender → pink; the gradient is
          the elevation. It drifts slowly. */}
      <div className="absolute inset-0 origin-center bg-aurora animate-aurora-drift" />
      {/* Violet depth bloom toward the horizon */}
      <div className="absolute bottom-[-10rem] left-1/2 h-[44rem] w-[70rem] -translate-x-1/2 rounded-[50%] bg-lavender-mist/20 blur-3xl" />

      {/* Shadowed face profile, left edge */}
      <svg
        className="absolute -left-16 top-0 h-full w-auto animate-silhouette-float sm:-left-8"
        viewBox="0 0 520 1000"
        preserveAspectRatio="xMinYMid slice"
        fill="none"
      >
        <defs>
          <linearGradient id="hcFace" x1="0" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stopColor="#0a0b14" />
            <stop offset="60%" stopColor="#050509" />
            <stop offset="100%" stopColor="#000000" />
          </linearGradient>
          <linearGradient id="hcRim" x1="0.2" y1="0" x2="1" y2="0.6">
            <stop offset="0%" stopColor="#e8c9e9" stopOpacity="0.7" />
            <stop offset="60%" stopColor="#b89adf" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#7c84c8" stopOpacity="0" />
          </linearGradient>
          <filter id="hcSoft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <filter id="hcSofter" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        {/* Warm rim-light: an offset copy peeking along the lit contour */}
        <path d={PROFILE} transform="translate(7 -6)" fill="url(#hcRim)" filter="url(#hcSofter)" />
        {/* The shadowed face */}
        <path d={PROFILE} fill="url(#hcFace)" filter="url(#hcSoft)" opacity="0.96" />

        {/* Electric voice-waveform at the lips */}
        <g transform="translate(432 466)">
          {BARS.map((h, i) => (
            <rect
              key={i}
              x={i * 9}
              y={-h / 2}
              width={3.5}
              height={h}
              rx={1.75}
              fill="#0088ff"
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: `voice-bar 1.5s ease-in-out ${i * 0.12}s infinite`,
              }}
            />
          ))}
        </g>
      </svg>

      {/* Laptop edge catching the dusk light, lower-right, bleeding off */}
      <div className="absolute -bottom-28 -right-28 animate-laptop-float">
        <div className="relative h-[24rem] w-[34rem]">
          <div className="absolute inset-0 rounded-[1.75rem] bg-gradient-to-tl from-white/30 via-white/[0.08] to-transparent blur-[1px]" />
          {/* bright lid edge highlight */}
          <div className="absolute left-8 right-12 top-[2px] h-[3px] rounded-full bg-white/70 blur-[1px]" />
          {/* hinge line */}
          <div className="absolute inset-x-10 bottom-12 h-px bg-white/15" />
        </div>
      </div>

      {/* Soften the pink horizon back into the #000 canvas at the very bottom */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
