import { useState } from 'react'
import { inr, lakhCrStr, date } from '@/lib/format'
import type { CashWeek } from '@/lib/types'
import { cn } from '@/lib/utils'

const L = 1e5

/** One ₹ axis: collections up, payments down, closing balance as a line, minimum balance dashed. */
export function CashForecastChart({ opening, minimum, weeks, compact }: { opening: number; minimum: number; weeks: CashWeek[]; compact?: boolean }) {
  let bal = opening
  const pts = weeks.map(w => { bal += w.inflow - w.outflow; return { ...w, closing: bal } })
  const lowest = pts.reduce((a, b) => (b.closing < a.closing ? b : a))
  const [hover, setHover] = useState<number | null>(null)
  const active = hover ?? pts.indexOf(lowest)

  const W = compact ? 334 : 712, H = compact ? 150 : 276
  const x0 = compact ? 0 : 52, x1 = compact ? W : 704, top = compact ? 10 : 14, bottom = compact ? 132 : 244
  const maxV = Math.max(...pts.map(p => Math.max(p.closing, p.inflow)), minimum) / L
  const minV = -Math.max(...pts.map(p => p.outflow)) / L
  const step = [20, 40, 80, 160, 320].find(s => (maxV - minV) / s <= 6) ?? 400
  const hi = Math.ceil(maxV / step) * step, lo = Math.floor(minV / step) * step
  const y = (v: number) => top + (hi - v / L) * (bottom - top) / (hi - lo)
  const colW = (x1 - x0) / pts.length
  const cx = (i: number) => x0 + colW * (i + 0.5)
  const bw = compact ? 12 : 18
  const ticks: number[] = []; for (let v = hi; v >= lo; v -= step) ticks.push(v)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(p.closing).toFixed(1)}`).join(' ')
  const a = pts[active]
  const fmtTick = (v: number) => (v === 0 ? '₹0' : (v < 0 ? '−' : '') + '₹' + Math.abs(v) + ' L')

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="block overflow-visible"
        aria-label={`13-week cash forecast. Collections ${lakhCrStr(Math.min(...pts.map(p => p.inflow)))} to ${lakhCrStr(Math.max(...pts.map(p => p.inflow)))} a week, payments ${lakhCrStr(Math.min(...pts.map(p => p.outflow)))} to ${lakhCrStr(Math.max(...pts.map(p => p.outflow)))}. Closing balance lowest at ${lakhCrStr(lowest.closing)} in week of ${date(lowest.week)}, ends at ${lakhCrStr(pts.at(-1)!.closing)}.`}
        onMouseLeave={() => setHover(null)}>
        {!compact && ticks.map(v => (
          <g key={v}>
            <line x1={x0} x2={x1} y1={y(v * L)} y2={y(v * L)} style={{ stroke: v === 0 ? 'var(--text-3)' : 'var(--grid)', strokeWidth: 1 }} />
            <text x={44} y={y(v * L) + 3.5} textAnchor="end" style={{ fill: 'var(--text-3)', fontSize: 10.5 }}>{fmtTick(v)}</text>
          </g>
        ))}
        {compact && <line x1={0} x2={W} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--text-3)', strokeWidth: 1 }} />}
        <line x1={x0} x2={x1} y1={y(minimum)} y2={y(minimum)} style={{ stroke: 'var(--bad)', strokeWidth: 1.5, strokeDasharray: '5 4' }} />
        {!compact && <line x1={cx(active)} x2={cx(active)} y1={top} y2={bottom} style={{ stroke: 'var(--border-2)', strokeWidth: 1 }} />}
        {pts.map((p, i) => {
          const yi = y(p.inflow), yo = y(-p.outflow), y0 = y(0)
          return (
            <g key={p.week}>
              {/* 4px rounded data ends, square at the baseline, 2px gap either side of zero */}
              <path d={`M${cx(i) - bw / 2} ${y0 - 1} V${yi + 4} q0 -4 4 -4 h${bw - 8} q4 0 4 4 V${y0 - 1} Z`} style={{ fill: 'var(--s-in)' }} />
              <path d={`M${cx(i) - bw / 2} ${y0 + 1} V${yo - 4} q0 4 4 4 h${bw - 8} q4 0 4 -4 V${y0 + 1} Z`} style={{ fill: 'var(--s-out)' }} />
              {!compact && <text x={cx(i)} y={262} textAnchor="middle" style={{ fill: 'var(--text-3)', fontSize: 10.5 }}>{date(p.week).slice(0, 5)}</text>}
            </g>
          )
        })}
        <path d={line} style={{ fill: 'none', stroke: 'var(--s-line)', strokeWidth: 2, strokeLinejoin: 'round' }} />
        {!compact && pts.map((p, i) => <circle key={p.week} cx={cx(i)} cy={y(p.closing)} r={3.5} style={{ fill: 'var(--s-line)', stroke: 'var(--card)', strokeWidth: 2 }} />)}
        <circle cx={cx(active)} cy={y(a.closing)} r={6} style={{ fill: 'none', stroke: 'var(--s-line)', strokeWidth: 2 }} />
        {!compact && <text x={x1} y={y(minimum) - 5} textAnchor="end" style={{ fill: 'var(--bad)', fontSize: 10.5, fontWeight: 600 }}>Min {lakhCrStr(minimum)}</text>}
        {compact && <><text x={0} y={146} style={{ fill: 'var(--text-3)', fontSize: 10 }}>{date(pts[0].week).slice(0, 5)}</text><text x={W} y={146} textAnchor="end" style={{ fill: 'var(--text-3)', fontSize: 10 }}>{date(pts.at(-1)!.week).slice(0, 5)}</text></>}
        {/* hit targets wider than the marks */}
        {!compact && pts.map((p, i) => <rect key={p.week} x={x0 + colW * i} y={top} width={colW} height={bottom - top + 24} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`Week of ${date(p.week)}: collections ${inr(p.inflow)}, payments ${inr(p.outflow)}, closing ${inr(p.closing)}`} />)}
      </svg>
      {!compact && (
        <div className={cn('pointer-events-none absolute min-w-[190px] rounded-lg border border-border-2 bg-surface px-2.5 py-2 text-xs leading-[18px] shadow-pv')}
          style={{ left: `clamp(0px, calc(${(cx(active) / W) * 100}% + 12px), calc(100% - 200px))`, top: 92 }}>
          <div className="font-medium">Week of {date(a.week)}</div>
          <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-text-2"><span className="size-2 rounded-[2px] bg-s-in" />Collections</span><span className="tabular-nums">{inr(a.inflow)}</span></div>
          <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-text-2"><span className="size-2 rounded-[2px] bg-s-out" />Payments</span><span className="tabular-nums">{inr(-a.outflow)}</span></div>
          <div className="mt-1 flex justify-between gap-4 border-t border-border pt-1"><span className="text-text-2">Closing</span><span className="font-semibold tabular-nums">{inr(a.closing)}</span></div>
          {a === lowest && <div className="mt-0.5 text-[11px] text-warn">Lowest in 13 weeks · {lakhCrStr(a.closing - minimum)} above minimum</div>}
          {a.closing < minimum && <div className="mt-0.5 text-[11px] text-bad">Below minimum balance</div>}
        </div>
      )}
    </div>
  )
}

export function CashForecastTable({ opening, weeks }: { opening: number; weeks: CashWeek[] }) {
  let bal = opening
  return (
    <div className="max-h-[300px] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-[12.5px]">
        <thead><tr className="[&>th]:sticky [&>th]:top-0 [&>th]:border-b [&>th]:border-border [&>th]:bg-surface-2 [&>th]:px-2.5 [&>th]:py-2 [&>th]:text-right [&>th]:text-[11.5px] [&>th]:font-semibold [&>th]:text-text-2"><th className="text-left!">Week of</th><th>Collections</th><th>Payments</th><th>Closing</th></tr></thead>
        <tbody>{weeks.map(w => { bal += w.inflow - w.outflow; return <tr key={w.week} className="[&>td]:border-b [&>td]:border-border [&>td]:px-2.5 [&>td]:py-1.5 [&>td]:text-right [&>td]:tabular-nums"><td className="text-left!">{date(w.week)}</td><td>{inr(w.inflow)}</td><td className="text-bad">{inr(-w.outflow)}</td><td className="font-medium">{inr(bal)}</td></tr> })}</tbody>
      </table>
    </div>
  )
}

export const forecastSummary = (opening: number, weeks: CashWeek[]) => {
  let bal = opening; let low = { v: Infinity, week: '' }
  for (const w of weeks) { bal += w.inflow - w.outflow; if (bal < low.v) low = { v: bal, week: w.week } }
  return { closing: bal, low }
}
