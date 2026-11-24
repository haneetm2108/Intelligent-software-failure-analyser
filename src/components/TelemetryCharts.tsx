import React, { useState } from 'react';
import type { RiskLevel, RuntimeMetricPoint } from '../types';

export function riskColorClasses(level: RiskLevel): {
  text: string;
  bg: string;
  border: string;
  bar: string;
} {
  switch (level) {
    case 'Critical':
      return {
        text: 'text-red-700',
        bg: 'bg-red-50',
        border: 'border-red-200',
        bar: 'bg-red-600',
      };
    case 'High Risk':
      return {
        text: 'text-red-700',
        bg: 'bg-red-50',
        border: 'border-red-200',
        bar: 'bg-red-500',
      };
    case 'Warning':
      return {
        text: 'text-amber-700',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        bar: 'bg-amber-500',
      };
    default:
      return {
        text: 'text-emerald-700',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        bar: 'bg-emerald-600',
      };
  }
}

export function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface DualLineChartProps {
  metrics: RuntimeMetricPoint[];
  title: string;
  subtitle: string;
  primaryLabel: string;
  secondaryLabel: string;
  getPrimary: (m: RuntimeMetricPoint) => number;
  getSecondary: (m: RuntimeMetricPoint) => number;
  primaryUnit: string;
  secondaryUnit: string;
  primaryColor?: string;
  secondaryColor?: string;
}

export const DualMetricChart: React.FC<DualLineChartProps> = ({
  metrics,
  title,
  subtitle,
  primaryLabel,
  secondaryLabel,
  getPrimary,
  getSecondary,
  primaryUnit,
  secondaryUnit,
  primaryColor = '#dc2626',
  secondaryColor = '#1d4ed8',
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (metrics.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="mt-8 text-xs text-slate-500 text-center py-8">
          No telemetry samples collected yet for this application.
        </div>
      </div>
    );
  }

  const width = 560;
  const height = 190;
  const padX = 38;
  const padY = 20;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const pVals = metrics.map(getPrimary);
  const sVals = metrics.map(getSecondary);
  const maxP = Math.max(...pVals, 5) * 1.15;
  const maxS = Math.max(...sVals, 10) * 1.15;

  const xAt = (idx: number) =>
    metrics.length === 1 ? padX + plotW / 2 : padX + (idx / (metrics.length - 1)) * plotW;

  const yP = (v: number) => padY + plotH - (v / maxP) * plotH;
  const yS = (v: number) => padY + plotH - (v / maxS) * plotH;

  const pathP = metrics.map((m, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yP(getPrimary(m)).toFixed(1)}`).join(' ');
  const pathS = metrics.map((m, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yS(getSecondary(m)).toFixed(1)}`).join(' ');

  const hovered = hoverIdx !== null ? metrics[hoverIdx] : metrics[metrics.length - 1];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-4 text-xs tabular-nums font-mono">
          <span className="flex items-center gap-1.5 text-slate-700">
            <span className="inline-block w-2.5 h-0.5" style={{ backgroundColor: primaryColor }} />
            {primaryLabel}: {getPrimary(hovered).toFixed(primaryUnit === '%' ? 1 : 0)}{primaryUnit}
          </span>
          <span className="flex items-center gap-1.5 text-slate-700">
            <span className="inline-block w-2.5 h-0.5" style={{ backgroundColor: secondaryColor }} />
            {secondaryLabel}: {getSecondary(hovered).toFixed(secondaryUnit === '%' ? 1 : 0)}{secondaryUnit}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-48 overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padY + plotH * frac;
          const labelVal = Math.round(maxP * (1 - frac));
          return (
            <g key={frac}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padX - 6} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px] font-mono">
                {labelVal}
              </text>
            </g>
          );
        })}

        <path d={pathS} fill="none" stroke={secondaryColor} strokeWidth="2" strokeLinejoin="round" />
        <path d={pathP} fill="none" stroke={primaryColor} strokeWidth="2" strokeLinejoin="round" />

        {metrics.map((m, idx) => {
          const cx = xAt(idx);
          const cy1 = yP(getPrimary(m));
          const cy2 = yS(getSecondary(m));
          const isActive = hoverIdx === idx;
          return (
            <g key={m.id}>
              <circle
                cx={cx}
                cy={cy1}
                r={isActive ? 4.5 : 2.5}
                fill={primaryColor}
                className="transition-all"
              />
              <circle
                cx={cx}
                cy={cy2}
                r={isActive ? 4.5 : 2.5}
                fill={secondaryColor}
                className="transition-all"
              />
              <rect
                x={cx - plotW / Math.max(metrics.length * 2, 4)}
                y={padY}
                width={plotW / Math.max(metrics.length, 2)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(idx)}
              />
            </g>
          );
        })}

        <text x={padX} y={height - 2} className="fill-slate-400 text-[10px] font-mono">
          {formatShortTime(metrics[0].timestamp)}
        </text>
        <text x={width - padX} y={height - 2} textAnchor="end" className="fill-slate-400 text-[10px] font-mono">
          {formatShortTime(metrics[metrics.length - 1].timestamp)}
        </text>
      </svg>
    </div>
  );
};
