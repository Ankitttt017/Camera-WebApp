import React, { useMemo, useState } from 'react';
import { RecordingRecord } from './api';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Legend, LabelList,
} from 'recharts';

interface DashboardProps {
  records: RecordingRecord[];
  businessRange?: { fromDate: string; toDate: string; startAt: string; endAt: string } | null;
  thresholdSeconds?: number;
}

/* ─── Standard Plant Industrial Colors (Rico Auto / TPM Norms) ─── */
const INDUSTRIAL_COLORS = {
  breakdown: '#ef4444', // Red - Machine / Critical Breakdown
  minor:     '#f59e0b', // Amber - Minor Stoppage / Short Idle
  operator:  '#0284c7', // Sky Blue - Operator Triggered
  shiftA:    '#3b82f6', // Royal Blue - Shift A
  shiftB:    '#10b981', // Emerald Green - Shift B
  shiftC:    '#8b5cf6', // Violet - Shift C
};

const CATEGORY_COLOR: Record<string, string> = {
  'Machine Breakdown':        '#ef4444', // Red
  'Die Breakdown':            '#ea580c', // Deep Orange
  'Minor Stoppage':           '#f59e0b', // Amber
  'Robot Breakdown':          '#9333ea', // Purple
  'Process Loss':             '#2563eb', // Blue
  'HPDC Machine Accessories': '#ec4899', // Pink
  'Planned Downtime':         '#10b981', // Green
  'Tool / Die Change':        '#06b6d4', // Cyan
  'Management Loss':          '#64748b', // Slate
  'Operator Triggered':       '#0284c7', // Sky Blue
};

const catColor = (name: string) => CATEGORY_COLOR[name] || (name.toLowerCase().includes('minor') ? '#f59e0b' : '#3b82f6');

/* ─── Helpers ─────────────────────────────────────────────────── */
function fmtShort(sec: number) {
  if (!sec || sec < 0) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function thresholdLabel(sec?: number) {
  const s = Math.max(1, Number(sec || 300));
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s}s`;
}

function evtDur(r: RecordingRecord) {
  return r.event_duration_seconds || r.duration_seconds || 0;
}

function hasRca(r: RecordingRecord) {
  const reason = (r.reason || r.manual_transcript || '').trim();
  return !(!reason || reason.toLowerCase() === 'pending reason');
}

/* ── Clean Enterprise Tooltip ──────────────────────────────────── */
const ttStyle = {
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '10px',
  color: '#0f172a',
  padding: '10px 14px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
};
const ttItemStyle = { color: '#334155', fontSize: '12px', padding: '2px 0', fontWeight: 600 };
const ttLabelStyle = { color: '#0f172a', fontWeight: 800, fontSize: '13px', marginBottom: 4 };

/* ── Custom Pie Slice Label (Direct On-Chart Data Label) ────────── */
const renderShiftSliceLabel = ({ cx, cy, midAngle, outerRadius, value, name, pct, sec }: any) => {
  if (!value || value <= 0) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 22;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#334155"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={12}
      fontWeight={600}
    >
      {`${name} · ${fmtShort(sec)} (${pct}%)`}
    </text>
  );
};

/* ─── Component ───────────────────────────────────────────────── */
export const Dashboard: React.FC<DashboardProps> = ({ records, businessRange, thresholdSeconds = 300 }) => {
  const [hourlyViewMode, setHourlyViewMode] = useState<'stacked' | 'sideBySide'>('stacked');

  const stats = useMemo(() => {
    let bdSec = 0, minSec = 0, opSec = 0;
    let bdCnt = 0, minCnt = 0, opCnt = 0;
    let docCnt = 0, pendCnt = 0;

    const hourlyMap = Array.from({ length: 24 }, () => ({
      bd: 0, min: 0, op: 0, durSec: 0,
    }));
    const shiftMap = { A: 0, B: 0, C: 0 };
    const shiftCntMap = { A: 0, B: 0, C: 0 };
    const reasonDur: Record<string, number> = {};
    const reasonCnt: Record<string, number> = {};
    const catMap: Record<string, { sec: number; count: number }> = {};

    const startBoundary = businessRange?.startAt ? new Date(businessRange.startAt).getTime() : null;
    const endBoundary = businessRange?.endAt ? new Date(businessRange.endAt).getTime() : null;

    const valid = records.filter(r => {
      if (!r.started_at) return false;
      const t = new Date(r.started_at).getTime();
      if (isNaN(t)) return false;
      if (startBoundary !== null && t < startBoundary) return false;
      if (endBoundary !== null && t > endBoundary) return false;
      return true;
    });

    valid.forEach(r => {
      const dur = evtDur(r);
      const isBd = r.event_type === 'breakdown';
      const isMin = r.event_type === 'minor_stoppage';

      if (isBd) { bdCnt++; bdSec += dur; }
      else if (isMin) { minCnt++; minSec += dur; }
      else { opCnt++; opSec += dur; }

      if (hasRca(r)) docCnt++; else pendCnt++;

      const d = new Date(r.started_at as string);
      if (isNaN(d.getTime())) return;

      const h = d.getHours();
      const tNum = h + d.getMinutes() / 60;
      const shift = tNum >= 6 && tNum < 14 ? 'A' : tNum >= 14 && tNum < 22 ? 'B' : 'C';
      shiftMap[shift] += dur;
      shiftCntMap[shift]++;

      hourlyMap[h].durSec += dur;
      if (isBd) hourlyMap[h].bd++;
      else if (isMin) hourlyMap[h].min++;
      else hourlyMap[h].op++;

      // Clean reason label
      let rsn = (r.reason || '').trim();
      if (!rsn || rsn.toLowerCase() === 'pending reason') rsn = 'Pending Reason';
      else if (rsn.includes(' - ')) {
        const parts = rsn.split(' - ');
        rsn = parts.length > 2 ? `${parts[1]} - ${parts[2]}` : parts[parts.length - 1];
      }
      reasonDur[rsn] = (reasonDur[rsn] || 0) + dur;
      reasonCnt[rsn] = (reasonCnt[rsn] || 0) + 1;

      // Category
      let cat = (r.reason_category || '').trim();
      if (!cat || ['breakdown', 'minor_stoppage', 'self_capture'].includes(cat)) {
        const raw = (r.reason || '').trim();
        cat = raw.includes(' - ') ? raw.split(' - ')[0].trim()
            : isBd ? 'Machine Breakdown'
            : isMin ? 'Minor Stoppage'
            : 'Operator Triggered';
      }
      if (!catMap[cat]) catMap[cat] = { sec: 0, count: 0 };
      catMap[cat].sec += dur;
      catMap[cat].count++;
    });

    const totalSec = bdSec + minSec + opSec;
    const totalEvents = valid.length;
    const rcaPct = totalEvents > 0 ? Math.round((docCnt / totalEvents) * 100) : 0;
    const maxSec = valid.reduce((mx, r) => Math.max(mx, evtDur(r)), 0);
    const avgBdSec = bdCnt > 0 ? bdSec / bdCnt : 0;

    // Hourly Timeline (Factory order: 06:00 to 05:00 next day)
    const factorySeq = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5];
    const hourlyData = factorySeq.map(h => {
      const hd = hourlyMap[h];
      const shiftLabel = h >= 6 && h < 14 ? 'A' : h >= 14 && h < 22 ? 'B' : 'C';
      const total = hd.bd + hd.min;
      return {
        name: `${String(h).padStart(2, '0')}:00`,
        shift: shiftLabel,
        bd: hd.bd,
        min: hd.min,
        total,
        bdLabel: hd.bd > 0 ? String(hd.bd) : '',
        minLabel: hd.min > 0 ? String(hd.min) : '',
        totalLabel: total > 0 ? String(total) : '',
      };
    });

    // Shift summary with direct display label
    const shiftSummary = [
      { key: 'A', name: 'Shift A', value: +(shiftMap.A / 3600).toFixed(2), sec: shiftMap.A, fill: INDUSTRIAL_COLORS.shiftA, count: shiftCntMap.A, pct: totalSec > 0 ? Math.round((shiftMap.A / totalSec) * 100) : 0 },
      { key: 'B', name: 'Shift B', value: +(shiftMap.B / 3600).toFixed(2), sec: shiftMap.B, fill: INDUSTRIAL_COLORS.shiftB, count: shiftCntMap.B, pct: totalSec > 0 ? Math.round((shiftMap.B / totalSec) * 100) : 0 },
      { key: 'C', name: 'Shift C', value: +(shiftMap.C / 3600).toFixed(2), sec: shiftMap.C, fill: INDUSTRIAL_COLORS.shiftC, count: shiftCntMap.C, pct: totalSec > 0 ? Math.round((shiftMap.C / totalSec) * 100) : 0 },
    ].map(s => ({
      ...s,
      displayLabel: `${s.name} · ${fmtShort(s.sec)} (${s.pct}%)`,
    }));
    const shiftData = shiftSummary.filter(d => d.value > 0);

    // Top Stoppage Reasons (Ranked by hours) with direct display label
    const topReasons = Object.keys(reasonDur)
      .map(k => {
        const hrs = +(reasonDur[k] / 3600).toFixed(2);
        const cnt = reasonCnt[k];
        return {
          name: k.length > 34 ? k.slice(0, 34) + '…' : k,
          fullName: k,
          hours: hrs,
          sec: reasonDur[k],
          count: cnt,
          pct: totalSec > 0 ? +((reasonDur[k] / totalSec) * 100).toFixed(1) : 0,
          mins: +(reasonDur[k] / 60).toFixed(1),
          displayLabel: `${fmtShort(reasonDur[k])} · ${cnt} ${cnt === 1 ? 'stop' : 'stops'}`,
        };
      })
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 6);

    // Category data (Horizontal bars) with direct display label
    const catData = Object.entries(catMap)
      .map(([name, info]) => {
        const hrs = +(info.sec / 3600).toFixed(2);
        return {
          name: name.length > 24 ? name.slice(0, 24) + '…' : name,
          fullName: name,
          hours: hrs,
          sec: info.sec,
          count: info.count,
          fill: catColor(name),
          mins: +(info.sec / 60).toFixed(1),
          displayLabel: `${fmtShort(info.sec)} · ${info.count} ${info.count === 1 ? 'stop' : 'stops'}`,
        };
      })
      .filter(d => d.hours > 0 || d.count > 0)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 6);

    // Top 5 Longest Stoppages
    const top5 = [...valid]
      .sort((a, b) => evtDur(b) - evtDur(a))
      .slice(0, 5)
      .map((r, i) => {
        const sec = evtDur(r);
        const d = r.started_at ? new Date(r.started_at) : null;
        return {
          rank: i + 1,
          duration: fmtShort(sec),
          date: d ? d.toLocaleString('en-GB') : '-',
          category: r.reason_category || (r.event_type === 'breakdown' ? 'Machine Breakdown' : 'Minor Stoppage'),
          reason: (r.reason || 'Pending reason').split(' - ').pop() || 'Pending reason',
          rca: hasRca(r),
          isBd: r.event_type === 'breakdown',
        };
      });

    return {
      totalSec, totalEvents, bdSec, minSec, opSec,
      bdCnt, minCnt, opCnt,
      rcaPct, pendCnt, docCnt, maxSec, avgBdSec,
      hourlyData, shiftData, shiftSummary, topReasons, catData, top5,
    };
  }, [records, businessRange]);

  const threshold = thresholdLabel(thresholdSeconds);

  /* ── Guard for no data ───────────────────────────────────────── */
  if (stats.totalEvents === 0) {
    return (
      <div className="er-table-card">
        <div className="er-empty">
          <strong>No stoppages in this period</strong>
          <span>No minor stoppage or breakdown was recorded for the selected filters. Change the date range and apply again.</span>
        </div>
      </div>
    );
  }

  const emptyChart = (h = 240) => (
    <div className="an-chart-empty" style={{ height: h }}>No stoppage data for this chart</div>
  );

  const kpis: { label: string; value: string | number; sub?: string; icon: keyof typeof KPI_ICONS; tone: string }[] = [
    { label: 'Total stoppages', value: stats.totalEvents, icon: 'list', tone: 'blue' },
    { label: 'Total downtime', value: fmtShort(stats.totalSec), icon: 'clock', tone: 'violet' },
    { label: `Breakdowns (> ${threshold})`, value: stats.bdCnt, sub: fmtShort(stats.bdSec), icon: 'alert', tone: 'red' },
    { label: `Minor stoppages (< ${threshold})`, value: stats.minCnt, sub: fmtShort(stats.minSec), icon: 'pause', tone: 'amber' },
    { label: 'Longest stoppage', value: fmtShort(stats.maxSec), icon: 'trend', tone: 'slate' },
    {
      label: 'Reason pending',
      value: `${stats.pendCnt} / ${stats.totalEvents}`,
      sub: `${stats.rcaPct}% reasons filled`,
      icon: 'check',
      tone: stats.rcaPct >= 80 ? 'green' : stats.rcaPct >= 50 ? 'amber' : 'red',
    },
  ];

  const onlyPendingReasons = stats.topReasons.length === 1 && stats.topReasons[0].fullName === 'Pending Reason';

  return (
    <div className="an-dashboard">

      {/* ── KPI cards ── */}
      <div className="er-kpis an-kpis">
        {kpis.map(k => (
          <div key={k.label} className={`er-kpi er-kpi-${k.tone}`}>
            <span className="er-kpi-icon">
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={KPI_ICONS[k.icon]} /></svg>
            </span>
            <div>
              <span className="er-kpi-label">{k.label}</span>
              <strong className="er-kpi-value">{k.value}</strong>
              {k.sub && <span className="an-kpi-sub">{k.sub}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Hourly trend ── */}
      <section className="an-card">
        <header className="an-card-head">
          <div>
            <h3>Stoppages by hour</h3>
            <p>Factory day 06:00 to 06:00 next morning</p>
          </div>
          <div className="an-card-tools">
            <span className="an-legend"><i style={{ background: INDUSTRIAL_COLORS.breakdown }} />Breakdown</span>
            <span className="an-legend"><i style={{ background: INDUSTRIAL_COLORS.minor }} />Minor stoppage</span>
            <div className="an-toggle" role="group" aria-label="Bar layout">
              <button type="button" className={hourlyViewMode === 'stacked' ? 'is-active' : undefined} onClick={() => setHourlyViewMode('stacked')}>Stacked</button>
              <button type="button" className={hourlyViewMode === 'sideBySide' ? 'is-active' : undefined} onClick={() => setHourlyViewMode('sideBySide')}>Side by side</button>
            </div>
          </div>
        </header>

        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={stats.hourlyData}
            margin={{ top: 22, right: 16, left: 0, bottom: 4 }}
            barGap={hourlyViewMode === 'sideBySide' ? 2 : 0}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="name"
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={{ stroke: '#cbd5e1' }}
              tickLine={false}
              interval={0}
              angle={-45}
              textAnchor="end"
              height={48}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, (dataMax: number) => Math.max(4, Math.ceil(dataMax * 1.15))]}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={40}
              label={{ value: 'Stoppages', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11, offset: 10 }}
            />
            <RechartsTooltip
              cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
              contentStyle={ttStyle}
              itemStyle={ttItemStyle}
              labelStyle={ttLabelStyle}
              formatter={(v: any, name: any, item: any) => [
                `${v} (Shift ${item?.payload?.shift || ''})`,
                name === 'Breakdown' ? `Breakdown (> ${threshold})` : `Minor stoppage (< ${threshold})`,
              ]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="bd"
              name="Breakdown"
              stackId={hourlyViewMode === 'stacked' ? 'hourlyStack' : undefined}
              fill={INDUSTRIAL_COLORS.breakdown}
              barSize={hourlyViewMode === 'stacked' ? 24 : 12}
              radius={hourlyViewMode === 'stacked' ? [0, 0, 0, 0] : [3, 3, 0, 0]}
            >
              <LabelList
                dataKey="bdLabel"
                position={hourlyViewMode === 'stacked' ? 'inside' : 'top'}
                fill={hourlyViewMode === 'stacked' ? '#ffffff' : '#b91c1c'}
                fontSize={11}
                fontWeight={700}
              />
            </Bar>
            <Bar
              isAnimationActive={false}
              dataKey="min"
              name="Minor Stoppage"
              stackId={hourlyViewMode === 'stacked' ? 'hourlyStack' : undefined}
              fill={INDUSTRIAL_COLORS.minor}
              barSize={hourlyViewMode === 'stacked' ? 24 : 12}
              radius={[3, 3, 0, 0]}
            >
              <LabelList
                dataKey={hourlyViewMode === 'stacked' ? 'totalLabel' : 'minLabel'}
                position="top"
                fill={hourlyViewMode === 'stacked' ? '#0f172a' : '#b45309'}
                fontSize={11}
                fontWeight={700}
                offset={4}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* ── Shift + category ── */}
      <div className="an-grid-2">
        <section className="an-card">
          <header className="an-card-head">
            <div>
              <h3>Downtime by shift</h3>
              <p>Share of lost time per production shift</p>
            </div>
          </header>

          {stats.shiftSummary.some(s => s.value > 0) ? (
            <div style={{ position: 'relative', width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart margin={{ top: 10, right: 40, left: 40, bottom: 10 }}>
                  <Pie
                    isAnimationActive={false}
                    data={stats.shiftData}
                    cx="50%"
                    cy="46%"
                    innerRadius={62}
                    outerRadius={86}
                    dataKey="value"
                    nameKey="name"
                    stroke="#ffffff"
                    strokeWidth={3}
                    paddingAngle={stats.shiftData.length > 1 ? 3 : 0}
                    label={renderShiftSliceLabel}
                    labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                  >
                    {stats.shiftData.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={ttStyle}
                    itemStyle={ttItemStyle}
                    labelStyle={ttLabelStyle}
                    formatter={(_: any, name: any, item: any) => [
                      `${fmtShort(item.payload.sec)} · ${item.payload.count || 0} stops`,
                      item.payload.name || name,
                    ]}
                  />
                  <Legend align="center" verticalAlign="bottom" height={28} iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#475569' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="an-donut-center">
                <span>Total loss</span>
                <strong>{fmtShort(stats.totalSec)}</strong>
              </div>
            </div>
          ) : emptyChart(260)}
        </section>

        <section className="an-card">
          <header className="an-card-head">
            <div>
              <h3>Downtime by category</h3>
              <p>Lost time and number of stops per loss type</p>
            </div>
          </header>

          {stats.catData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.catData} layout="vertical" margin={{ top: 10, right: 110, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}m`} dataKey="mins" />
                <YAxis dataKey="name" type="category" tick={{ fill: '#0f172a', fontSize: 12, fontWeight: 600 }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} width={160} />
                <RechartsTooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
                  contentStyle={ttStyle}
                  itemStyle={ttItemStyle}
                  labelStyle={ttLabelStyle}
                  formatter={(_: any, __: any, item: any) => [item.payload.displayLabel, 'Downtime']}
                  labelFormatter={(_: any, payload: readonly any[]) => (payload as any)?.[0]?.payload?.fullName || _}
                />
                <Bar isAnimationActive={false} dataKey="mins" name="Downtime" radius={[0, 4, 4, 0]} barSize={stats.catData.length <= 2 ? 28 : 20}>
                  {stats.catData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                  <LabelList dataKey="displayLabel" position="right" fill="#334155" fontSize={12} fontWeight={600} offset={8} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : emptyChart(260)}
        </section>
      </div>

      {/* ── Top reasons ── */}
      <section className="an-card">
        <header className="an-card-head">
          <div>
            <h3>Top stoppage reasons</h3>
            <p>Root causes ranked by lost time</p>
          </div>
        </header>

        {onlyPendingReasons && (
          <div className="an-notice">
            No downtime reason has been filled for this period yet. Add reasons in the Event Report so this chart can show real root causes.
          </div>
        )}

        {stats.topReasons.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(120, stats.topReasons.length * 46 + 30)}>
            <BarChart data={stats.topReasons} layout="vertical" margin={{ top: 6, right: 120, left: 0, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" dataKey="mins" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}m`} />
              <YAxis dataKey="name" type="category" tick={{ fill: '#0f172a', fontSize: 12, fontWeight: 600 }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} width={230} />
              <RechartsTooltip
                cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
                contentStyle={ttStyle}
                itemStyle={ttItemStyle}
                labelStyle={ttLabelStyle}
                formatter={(_: any, __: any, item: any) => [`${item.payload.displayLabel} · ${item.payload.pct}% of downtime`, 'Lost time']}
                labelFormatter={(_: any, payload: readonly any[]) => (payload as any)?.[0]?.payload?.fullName || _}
              />
              <Bar isAnimationActive={false} dataKey="mins" name="Lost time" radius={[0, 4, 4, 0]} barSize={22}>
                {stats.topReasons.map((d, i) => (
                  <Cell key={i} fill={d.fullName === 'Pending Reason' ? '#94a3b8' : INDUSTRIAL_COLORS.breakdown} />
                ))}
                <LabelList dataKey="displayLabel" position="right" fill="#334155" fontSize={12} fontWeight={600} offset={8} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : emptyChart(200)}
      </section>

      {/* ── Top 5 longest ── */}
      <section className="an-card an-card-flush">
        <header className="an-card-head">
          <div>
            <h3>Top 5 longest stoppages</h3>
            <p>Ranked by lost time — investigate these first</p>
          </div>
        </header>
        <div className="er-table-scroll">
          <table className="an-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date &amp; time</th>
                <th>Category</th>
                <th>Duration</th>
                <th>Root cause / reason</th>
                <th>Reason status</th>
              </tr>
            </thead>
            <tbody>
              {stats.top5.map(item => (
                <tr key={item.rank} className={item.isBd ? 'is-breakdown' : undefined}>
                  <td className="an-rank">{item.rank}</td>
                  <td className="an-nowrap">{item.date}</td>
                  <td>
                    <span className={item.isBd ? 'er-badge er-badge-red' : 'er-badge er-badge-amber'}>
                      <i aria-hidden="true" />
                      {item.category}
                    </span>
                  </td>
                  <td className="an-strong an-nowrap">{item.duration}</td>
                  <td className={item.rca ? undefined : 'er-muted'}>{item.rca ? item.reason : 'Not filled yet'}</td>
                  <td>
                    <span className={item.rca ? 'er-status er-status-green' : 'er-status er-status-amber'}>
                      {item.rca ? 'Reason added' : 'Reason pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const KPI_ICONS = {
  list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  pause: 'M7 5h4v14H7z M13 5h4v14h-4z',
  trend: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  check: 'M4 12l5 5L20 6',
};
