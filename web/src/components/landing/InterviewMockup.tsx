// InterviewMockup — the hero "product mockup" for the Cluely-style landing.
// Per the reference, the product screenshot is the hero: a floating, hairline-
// ringed frame whose interior is the DARK interview product UI (so it contrasts
// against the light page). It is a single-focus stage on the AI avatar
// interviewer — a large "speaking" feed with a live caption bar, call controls,
// and floating live-scorecard / proctoring chips.
import { useTranslation } from 'react-i18next';
import { Mic, Video, PhoneOff, Sparkles, BadgeCheck, ShieldCheck } from 'lucide-react';

// Voice-waveform bar heights (px) for the AI avatar "speaking" indicator.
const WAVE_BARS = [10, 22, 38, 18, 30, 14, 26, 12, 20, 16];

function Waveform() {
  return (
    <div className="flex items-end gap-[3px]" aria-hidden="true">
      {WAVE_BARS.map((h, i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom rounded-full bg-cluely-signal motion-safe:animate-voice-bar"
          style={{ height: `${h}px`, animationDelay: `${i * 0.11}s` }}
        />
      ))}
    </div>
  );
}

export default function InterviewMockup() {
  const { t } = useTranslation();

  return (
    <div className="relative mx-auto w-full max-w-3xl motion-safe:animate-cluely-float">
      {/* Floating app frame — hairline ring + soft ambient (no flat drop shadow) */}
      <div className="overflow-hidden rounded-[16px] bg-[#0b0c0f] shadow-cluely-mockup ring-1 ring-white/10">
        {/* ── Window chrome ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-2.5">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-medium text-white/70">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span>{t('landing.mockupLive')}</span>
            <span className="text-white/30">·</span>
            <span className="tabular-nums text-white/50">08:12</span>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/55">
            {t('landing.mockupQuestion')}
          </div>
        </div>

        {/* ── Two-tile video call: AI avatar interviewer + real candidate ── */}
        <div className="grid grid-cols-2 gap-2 p-2 sm:gap-3 sm:p-3">
          {/* AI avatar interviewer — photoreal avatar feed, badged as AI */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-[12px] bg-black ring-1 ring-inset ring-cluely-signal/40">
            <video
              className="h-full w-full object-cover"
              src="/intro/ai-interviewer.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
            {/* subtle AI tint so the rendered avatar reads distinct from the candidate */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0a1330]/55 via-transparent to-cluely-signal/10" />
            {/* AI badge */}
            <div className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-md bg-cluely-signal px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              AI
            </div>
            {/* name + speaking */}
            <div className="absolute inset-x-2.5 bottom-2.5 flex items-end justify-between">
              <span className="rounded-md bg-black/50 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                {t('landing.mockupAiName')}
              </span>
              <div className="flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 backdrop-blur-sm">
                <Waveform />
                <span className="text-[10px] font-medium text-cluely-signal">{t('landing.mockupAiStatus')}</span>
              </div>
            </div>
          </div>

          {/* Human candidate — real webcam feed */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-[12px] bg-black ring-1 ring-inset ring-white/15">
            <video
              className="h-full w-full object-cover"
              src="/intro/candidate-call.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
            <div className="absolute inset-x-2.5 bottom-2.5 flex items-center justify-between">
              <span className="rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                {t('landing.mockupYouName')}
              </span>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm" aria-hidden="true">
                <Mic className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>

        {/* ── Live caption / current question ───────────────────────────── */}
        <div className="mx-3 mb-1 flex items-start gap-2.5 rounded-[10px] bg-white/[0.04] px-3.5 py-3 ring-1 ring-inset ring-white/[0.06]">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cluely-signal/15 text-cluely-signal" aria-hidden="true">
            <Sparkles className="h-3 w-3" />
          </span>
          <p className="text-[13px] leading-snug text-white/80">{t('landing.mockupQuestionText')}</p>
        </div>

        {/* ── Call controls ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-2.5 px-3 pb-3.5 pt-1.5">
          <button type="button" tabIndex={-1} aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white">
            <Mic className="h-4 w-4" />
          </button>
          <button type="button" tabIndex={-1} aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white">
            <Video className="h-4 w-4" />
          </button>
          <button type="button" tabIndex={-1} aria-hidden="true" className="flex h-9 items-center gap-1.5 rounded-full bg-[#ff4d4f] px-4 text-[12px] font-medium text-white">
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Floating live-scorecard chip ────────────────────────────────── */}
      <div className="absolute -bottom-5 -right-3 hidden w-44 rotate-[1.5deg] rounded-[12px] border border-cluely-bone bg-cluely-chalk p-3 shadow-cluely-glow sm:block">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-cluely-fog">{t('landing.mockupScoreLabel')}</span>
          <BadgeCheck className="h-3.5 w-3.5 text-cluely-signal" aria-hidden="true" />
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="font-eb-garamond text-[28px] leading-none text-cluely-carbon">8.6</span>
          <span className="text-[11px] text-cluely-steel">/ 10</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cluely-vapor" aria-hidden="true">
          <div className="h-full w-[86%] rounded-full bg-cluely-signal" />
        </div>
      </div>

      {/* ── Floating "proctored" chip ───────────────────────────────────── */}
      <div className="absolute -left-3 top-10 hidden items-center gap-1.5 rounded-full border border-cluely-bone bg-cluely-chalk px-3 py-1.5 shadow-cluely-glow md:flex">
        <ShieldCheck className="h-3.5 w-3.5 text-cluely-signal" aria-hidden="true" />
        <span className="text-[11px] font-medium text-cluely-carbon">{t('landing.integrityBadge')}</span>
      </div>
    </div>
  );
}
