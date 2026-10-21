import React, { useMemo, useState } from 'react';
import { RecordingRecord } from './api';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Legend, LabelList, Area, AreaChart,
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

function fmtDigital(sec: number) {
  if (!sec || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
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
const renderShiftSliceLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value, name, pct }: any) => {
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
      fontSize={11.5}
      fontWeight={700}
    >
      {`${name}: ${value}h (${pct}%)`}
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
      displayLabel: `${s.name}: ${s.value}h (${s.pct}%)`,
    }));
    const shiftData = shiftSummary.filter(d => d.value > 0);

    // Top Stoppage Reasons (Ranked by hours) with direct display label
    const topReasons = Object.keys(reasonDur)
      .map(k => {
        const hrs = +(reasonDur[k] / 3600).toFixed(2);
        const cnt = reasonCnt[k];
        return {
          name: k.length > 24 ? k.slice(0, 24) + '…' : k,
          fullName: k,
          hours: hrs,
          sec: reasonDur[k],
          count: cnt,
          pct: totalSec > 0 ? +((reasonDur[k] / totalSec) * 100).toFixed(1) : 0,
          displayLabel: `${hrs}h (${cnt} stops)`,
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
          displayLabel: `${hrs}h (${info.count} stops)`,
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

  /* ── Guard for no data ───────────────────────────────────────── */
  if (stats.totalEvents === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: '3rem' }}>📋</div>
        <p style={{ marginTop: '12px', fontSize: '1.1rem', fontWeight: 600, color: '#94a3b8' }}>
          No records found for the selected filter period.
        </p>
      </div>
    );
  }

  const emptyChart = (h = 240) => (
    <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: '1.8rem' }}>📊</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>No stoppage data available</span>
    </div>
  );

  return (
    <div className="tpm-dashboard">

      {/* ── Page Header ── */}
      <div className="tpm-header">
        <h1>Machine Stoppage Analytics</h1>
        <p>Live analysis of {stats.totalEvents} stoppage records · Total Downtime: {fmtShort(stats.totalSec)}</p>
      </div>

      {/* ══════════════════════════════════════════════════════
          CORE KPI METRICS (Title Upar, Value Niche, No Faltu Comments)
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-kpi-grid">

        {/* 1. Total Events */}
        <div className="kpi-card color-blue">
          <div className="kpi-label">TOTAL STOPPAGES</div>
          <div className="kpi-val">{stats.totalEvents}</div>
        </div>

        {/* 2. Total Downtime */}
        <div className="kpi-card color-flame">
          <div className="kpi-label">TOTAL DOWNTIME</div>
          <div className="kpi-val">{fmtShort(stats.totalSec)}</div>
        </div>

        {/* 3. Breakdown (> threshold) */}
        <div className="kpi-card color-red">
          <div className="kpi-label">BREAKDOWN (&gt; {thresholdLabel(thresholdSeconds)})</div>
          <div className="kpi-val">{stats.bdCnt}</div>
        </div>

        {/* 4. Minor Stoppage (< threshold) */}
        <div className="kpi-card color-orange">
          <div className="kpi-label">MINOR STOPPAGE (&lt; {thresholdLabel(thresholdSeconds)})</div>
          <div className="kpi-val">{stats.minCnt}</div>
        </div>

        {/* 5. Longest Stoppage */}
        <div className="kpi-card color-purple">
          <div className="kpi-label">LONGEST STOPPAGE</div>
          <div className="kpi-val">{fmtShort(stats.maxSec)}</div>
        </div>

        {/* 6. Root Cause Action Status */}
        <div className={`kpi-card ${stats.rcaPct >= 80 ? 'color-green' : stats.rcaPct >= 50 ? 'color-orange' : 'color-red'}`}>
          <div className="kpi-label">ROOT CAUSE ACTION (RCA)</div>
          <div className="kpi-val">{stats.pendCnt} Pending</div>
        </div>

      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 1: SABSE PEHLA GRAPH - HOURLY STOPPAGE TREND (24-HOUR FACTORY DAY)
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-charts-layout">
        <div className="chart-box col-12">
          <div className="hourly-header-row">
            <div className="hourly-legend">
              <span className="hourly-legend-item">
                <span className="hourly-legend-box" style={{ background: '#ef4444' }} />
                Breakdown
              </span>
              <span className="hourly-legend-item">
                <span className="hourly-legend-box" style={{ background: '#f59e0b' }} />
                Minor Stoppage
              </span>
            </div>

            <div className="hourly-controls">
              <button
                type="button"
                className={`hourly-btn ${hourlyViewMode === 'stacked' ? 'active' : ''}`}
                onClick={() => setHourlyViewMode('stacked')}
              >
                Stacked
              </button>
              <button
                type="button"
                className={`hourly-btn ${hourlyViewMode === 'sideBySide' ? 'active' : ''}`}
                onClick={() => setHourlyViewMode('sideBySide')}
              >
                Side by side
              </button>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={290}>
            <BarChart
              data={stats.hourlyData}
              margin={{ top: 25, right: 25, left: 10, bottom: 25 }}
              barGap={hourlyViewMode === 'sideBySide' ? 2 : 0}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="name"
                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={45}
              />
              <YAxis
                allowDecimals={false}
                domain={[0, (dataMax: number) => Math.max(4, Math.ceil(dataMax * 1.15))]}
                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
                label={{ value: 'Incidents', angle: -90, position: 'insideLeft', fill: '#475569', fontSize: 12, fontWeight: 700, offset: 12 }}
              />

              <RechartsTooltip
                contentStyle={ttStyle}
                itemStyle={ttItemStyle}
                labelStyle={ttLabelStyle}
                formatter={(v: any, name: any, item: any) => [
                  `${v} incidents (Shift ${item?.payload?.shift || ''})`,
                  name === 'bd' || name === 'Breakdown' ? 'Breakdown (>2m)' : 'Minor Stoppage (<2m)'
                ]}
              />

              <Bar
                isAnimationActive={false}
                dataKey="bd"
                name="Breakdown"
                stackId={hourlyViewMode === 'stacked' ? 'hourlyStack' : undefined}
                fill="#ef4444"
                barSize={hourlyViewMode === 'stacked' ? 26 : 14}
                radius={hourlyViewMode === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
              >
                <LabelList
                  dataKey="bdLabel"
                  position={hourlyViewMode === 'stacked' ? 'inside' : 'top'}
                  fill={hourlyViewMode === 'stacked' ? '#ffffff' : '#ef4444'}
                  fontSize={11}
                  fontWeight={700}
                  offset={hourlyViewMode === 'stacked' ? 0 : 4}
                />
              </Bar>

              <Bar
                isAnimationActive={false}
                dataKey="min"
                name="Minor Stoppage"
                stackId={hourlyViewMode === 'stacked' ? 'hourlyStack' : undefined}
                fill="#f59e0b"
                barSize={hourlyViewMode === 'stacked' ? 26 : 14}
                radius={[4, 4, 0, 0]}
              >
                <LabelList
                  dataKey={hourlyViewMode === 'stacked' ? 'totalLabel' : 'minLabel'}
                  position="top"
                  fill={hourlyViewMode === 'stacked' ? '#0f172a' : '#d97706'}
                  fontSize={11}
                  fontWeight={700}
                  offset={4}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '8px', textAlign: 'left', paddingLeft: '8px', fontWeight: 500 }}>
            Factory day 06:00 to 06:00 next morning. Numbers read from your live graph.
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 2: SHIFT BREAKDOWN + CATEGORY LOSS (Side by Side)
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-charts-layout">

        {/* ── Chart: Downtime by Shift (Direct Data Labels On Graph) ── */}
        <div className="chart-box col-6">
          <div className="chart-box-header">
            <h4>Downtime by Shift</h4>
            <p className="chart-sub">Loss Distribution Across Production Shifts</p>
          </div>

          {stats.shiftSummary.some(s => s.value > 0) ? (
            <div style={{ position: 'relative', width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
                  <Pie
                    isAnimationActive={false}
                    data={stats.shiftData}
                    cx="50%"
                    cy="48%"
                    innerRadius={62}
                    outerRadius={88}
                    dataKey="value"
                    nameKey="name"
                    stroke="#ffffff"
                    strokeWidth={3}
                    paddingAngle={stats.shiftData.length > 1 ? 4 : 0}
                    label={renderShiftSliceLabel}
                    labelLine={{ stroke: '#94a3b8', strokeWidth: 1.5 }}
                  >
                    {stats.shiftData.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={ttStyle}
                    itemStyle={ttItemStyle}
                    labelStyle={ttLabelStyle}
                    formatter={(v: any, name: any, item: any) => [
                      `${v}h (${fmtShort(item.payload.sec || Number(v) * 3600)}) · ${item.payload.count || 0} stops`,
                      item.payload.name || name
                    ]}
                  />
                  <Legend
                    align="center"
                    verticalAlign="bottom"
                    height={32}
                    iconType="circle"
                    wrapperStyle={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Total Loss Centered inside Donut */}
              <div style={{ position: 'absolute', top: '48%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                  TOTAL LOSS
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', lineHeight: 1.15, marginTop: 2 }}>
                  {fmtShort(stats.totalSec)}
                </div>
              </div>
            </div>
          ) : emptyChart(260)}
        </div>

        {/* ── Chart: Downtime by Loss Category (Direct Values On Bars) ── */}
        <div className="chart-box col-6">
          <div className="chart-box-header">
            <h4>Downtime by Category</h4>
            <p className="chart-sub">Lost Duration &amp; Event Count per Loss Type</p>
          </div>

          {stats.catData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={stats.catData}
                layout="vertical"
                margin={{ top: 10, right: 85, left: 15, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis
                  type="number"
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fill: '#0f172a', fontSize: 12, fontWeight: 700 }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                  width={150}
                />
                <RechartsTooltip
                  contentStyle={ttStyle}
                  itemStyle={ttItemStyle}
                  labelStyle={ttLabelStyle}
                  formatter={(v: any, _: any, item: any) => [
                    `${v}h (${fmtShort(item.payload.sec || Number(v) * 3600)}) · ${item.payload.count} stops`,
                    'Downtime Loss'
                  ]}
                  labelFormatter={(_: any, payload: readonly any[]) => (payload as any)?.[0]?.payload?.fullName || _}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="hours"
                  name="Downtime"
                  radius={[0, 6, 6, 0]}
                  barSize={stats.catData.length <= 2 ? 32 : stats.catData.length <= 4 ? 24 : 18}
                >
                  {stats.catData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                  <LabelList
                    dataKey="displayLabel"
                    position="right"
                    fill="#0f172a"
                    fontSize={11.5}
                    fontWeight={700}
                    offset={10}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : emptyChart(260)}
        </div>

      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 3: TOP STOPPAGE REASONS (Direct Values On Bars)
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-charts-layout">
        <div className="chart-box col-12">
          <div className="chart-box-header">
            <h4>Top Stoppage Reasons</h4>
            <p className="chart-sub">Root Causes Ranked by Lost Hours</p>
          </div>

          {stats.topReasons.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={stats.topReasons}
                margin={{ top: 20, right: 30, left: 15, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />

                <XAxis
                  dataKey="name"
                  tick={{ fill: '#0f172a', fontSize: 12, fontWeight: 600 }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                  height={45}
                />

                <YAxis
                  tick={{ fill: '#dc2626', fontSize: 11, fontWeight: 700 }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                  label={{ value: 'Hours', angle: -90, position: 'insideLeft', fill: '#dc2626', fontSize: 12, fontWeight: 700, offset: 12 }}
                />

                <RechartsTooltip
                  contentStyle={ttStyle}
                  itemStyle={ttItemStyle}
                  labelStyle={ttLabelStyle}
                  formatter={(v: any, _: any, item: any) => [
                    `${v}h (${fmtShort(item.payload.sec || Number(v) * 3600)}) · ${item.payload.count} stops`,
                    'Downtime Loss'
                  ]}
                  labelFormatter={(_: any, payload: readonly any[]) => (payload as any)?.[0]?.payload?.fullName || _}
                />

                <Bar
                  isAnimationActive={false}
                  dataKey="hours"
                  name="Downtime (h)"
                  fill="#ef4444"
                  radius={[6, 6, 0, 0]}
                  barSize={stats.topReasons.length <= 2 ? 52 : 36}
                >
                  <LabelList
                    dataKey="displayLabel"
                    position="top"
                    fill="#dc2626"
                    fontSize={12}
                    fontWeight={700}
                    offset={6}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : emptyChart(260)}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 4: TOP 5 LONGEST STOPPAGES (CRITICAL EVENTS TABLE)
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-table-section" style={{ marginTop: '16px' }}>
        <div className="tpm-section-header">
          <h4 style={{ fontSize: '17px', fontWeight: 800, margin: '0 0 4px 0' }}>Top 5 Longest Stoppages</h4>
          <p className="chart-sub">Ranked by lost duration · High-priority investigation targets</p>
        </div>

        <div className="table-responsive">
          <table className="tpm-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th>Date &amp; Time</th>
                <th>Category</th>
                <th>Duration</th>
                <th>Root Cause / Reason</th>
                <th style={{ width: 140 }}>RCA Status</th>
              </tr>
            </thead>
            <tbody>
              {stats.top5.map(item => (
                <tr key={item.rank}>
                  <td>
                    <span style={{ fontWeight: 800, color: item.rank === 1 ? '#dc2626' : '#0f172a', fontSize: '14px' }}>
                      #{item.rank}
                    </span>
                  </td>
                  <td style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>{item.date}</td>
                  <td>
                    <span className={`tpm-badge ${item.isBd ? 'danger' : 'warning'}`}>
                      {item.category}
                    </span>
                  </td>
                  <td className="dur" style={{ color: '#0f172a', fontWeight: 800, fontSize: '14px', fontFamily: 'monospace' }}>
                    {item.duration}
                  </td>
                  <td className="reason-col" style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                    {item.reason}
                  </td>
                  <td>
                    <span className={`tpm-badge-outline ${item.rca ? 'success' : 'pending'}`}>
                      {item.rca ? '✓ RCA Done' : '⏳ Action Pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
