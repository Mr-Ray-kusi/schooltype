import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

const niceMax = (maxValue) => {
  const max = Number(maxValue) || 0;
  if (max <= 0) return 4;
  const padded = max * 1.15;
  const pow = 10 ** Math.floor(Math.log10(padded));
  const n = padded / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
};

const formatAxis = (value) => {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0))}m`;
  if (value >= 1000) return `${Number((value / 1000).toFixed(value % 1000 ? 1 : 0))}k`;
  return String(Math.round(value));
};

const splinePath = (points) => {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${
      p2.y - (p3.y - p1.y) / 6
    }, ${p2.x} ${p2.y}`;
  }
  return d;
};

const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
};

export const formatChartDate = (iso, unit) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  if (unit === 'hour') {
    return date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return `${ordinal(date.getDate())} ${date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
};

export const percentChange = (current, previous) => {
  if (previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
};

const PerformanceChart = ({
  points = [],
  unit = 'day',
  formatValue = (value) => Number(value || 0).toLocaleString(),
  className = '',
}) => {
  const wrapRef = useRef(null);
  const uid = useId().replace(/:/g, '');
  const [size, setSize] = useState({ w: 800, h: 320 });
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const sync = () => setSize({ w: Math.max(320, el.clientWidth), h: Math.max(240, el.clientHeight) });
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const pad = { l: 48, r: 18, t: 22, b: 36 };
    const innerW = Math.max(1, size.w - pad.l - pad.r);
    const innerH = Math.max(1, size.h - pad.t - pad.b);
    const values = points.map((point) => Number(point.value) || 0);
    const max = niceMax(Math.max(0, ...values));
    const mapped = points.map((point, index) => {
      const x = points.length <= 1 ? pad.l + innerW : pad.l + (index / (points.length - 1)) * innerW;
      const y = pad.t + innerH - (values[index] / max) * innerH;
      return { ...point, value: values[index], x, y, index };
    });
    const line = splinePath(mapped);
    const area = mapped.length
      ? `${line} L ${mapped[mapped.length - 1].x} ${pad.t + innerH} L ${mapped[0].x} ${pad.t + innerH} Z`
      : '';
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => {
      const value = max * (1 - part);
      return { value, y: pad.t + innerH * part, label: formatAxis(value) };
    });
    const maxLabels = Math.max(4, Math.floor(innerW / 68));
    const step = mapped.length <= maxLabels ? 1 : Math.ceil(mapped.length / maxLabels);
    return { pad, innerW, innerH, max, mapped, line, area, ticks, step };
  }, [points, size.h, size.w]);

  const active = hover == null ? null : layout.mapped[hover];

  const onMove = (event) => {
    if (!layout.mapped.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * size.w;
    const t = (svgX - layout.pad.l) / layout.innerW;
    const index = Math.round(t * Math.max(layout.mapped.length - 1, 0));
    setHover(Math.max(0, Math.min(layout.mapped.length - 1, index)));
  };

  return (
    <div ref={wrapRef} className={`relative h-[280px] w-full overflow-hidden rounded-2xl md:h-[340px] ${className}`}>
      <div className="chart-animated-bg pointer-events-none absolute inset-0" />
      <div className="chart-orb chart-orb-a -left-10 -top-8 h-52 w-52 bg-sky-500/30" />
      <div className="chart-orb chart-orb-b -bottom-10 -right-8 h-60 w-60 bg-emerald-500/25" />
      <div className="chart-orb chart-orb-c left-1/3 top-1/2 h-36 w-72 -translate-x-1/2 -translate-y-1/2 bg-rose-500/20" />
      <svg
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="relative z-10 h-full w-full overflow-visible"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (!touch) return;
          onMove({ currentTarget: event.currentTarget, clientX: touch.clientX });
        }}
        role="img"
        aria-label="Performance chart"
      >
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3498DB" stopOpacity="0.38" />
            <stop offset="70%" stopColor="#3498DB" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#3498DB" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`line-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3498DB" />
            <stop offset="100%" stopColor="#27AE60" />
          </linearGradient>
          <filter id={`glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {layout.ticks.map((tick) => (
          <g key={tick.y}>
            <line
              x1={layout.pad.l}
              x2={size.w - layout.pad.r}
              y1={tick.y}
              y2={tick.y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
            <text x={layout.pad.l - 10} y={tick.y + 4} textAnchor="end" className="fill-zinc-500 text-[11px]">
              {tick.label}
            </text>
          </g>
        ))}

        {layout.mapped.map((point, index) =>
          index % layout.step === 0 || index === layout.mapped.length - 1 ? (
            <text
              key={point.t}
              x={point.x}
              y={size.h - 12}
              textAnchor="middle"
              className="fill-zinc-500 text-[11px]"
            >
              {point.label}
            </text>
          ) : null
        )}

        {layout.area ? <path d={layout.area} fill={`url(#area-${uid})`} /> : null}
        {layout.line ? (
          <path
            d={layout.line}
            fill="none"
            stroke={`url(#line-${uid})`}
            strokeWidth="3"
            strokeLinecap="round"
            filter={`url(#glow-${uid})`}
          />
        ) : null}

        {active ? (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1={layout.pad.t}
              y2={layout.pad.t + layout.innerH}
              stroke="rgba(255,255,255,0.45)"
              strokeDasharray="4 5"
            />
            <circle cx={active.x} cy={active.y} r="8" fill="#27AE60" opacity="0.22" />
            <circle cx={active.x} cy={active.y} r="4.5" fill="#82e0aa" stroke="#fff" strokeWidth="1.5" />
          </>
        ) : null}
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[8.5rem] rounded-xl border border-white/10 bg-zinc-950/95 px-3 py-2 shadow-xl shadow-fuchsia-500/10"
          style={{
            left: `${Math.min(Math.max((active.x / size.w) * 100, 14), 86)}%`,
            top: `${Math.max(8, (active.y / size.h) * 100 - 18)}%`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <p className="text-[11px] text-zinc-400">{formatChartDate(active.t, unit)}</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-sm font-semibold text-white">{formatValue(active.value)}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PerformanceChart;
