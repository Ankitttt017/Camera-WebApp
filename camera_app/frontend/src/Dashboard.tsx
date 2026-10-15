import React, { useMemo } from 'react';
import { RecordingRecord } from './api';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Legend, LabelList, ComposedChart, Line, Area, AreaChart,
} from 'recharts';

interface DashboardProps {
  records: RecordingRecord[];
  businessRange?: { fromDate: string; toDate: string; startAt: string; endAt: string } | null;
  thresholdSeconds?: number;
}

/* ─── Executive Industrial Standard Colour Tokens (Rico Auto / TPM Standards) ─ */
const INDUSTRIAL_COLORS = {
  // Event & Loss Types
  breakdown:      '#ef4444', // Industrial Safety Red (Critical Stoppage > threshold)
  breakdownDark:  '#b91c1c',
  minor:          '#f59e0b', // Industrial Warning Amber (Stoppage < threshold)
  minorDark:      '#d97706',
  operator:       '#0284c7', // Sky Blue (Operator Triggered / Manual Capture)
  operational:    '#10b981', // Operational Emerald Green (Running / Target Met)
  pendingAction:  '#ea580c', // Action Pending Safety Orange

  // Shifts
  shiftA:         '#3b82f6', // Shift A - Industrial Royal Blue (06:00 - 14:00)
  shiftB:         '#10b981', // Shift B - Operational Emerald Green (14:00 - 22:00)
  shiftC:         '#8b5cf6', // Shift C - Night Shift Violet (22:00 - 06:00)

  // Pareto & Trend Lines
  cumulativeLine: '#38bdf8', // Neon Sky Cyan (Cumulative Loss)
  incidentLine:   '#06b6d4', // Vibrant Cyan (Incident Frequency)
  worstDayRed:    '#ef4444', // Critical Day Indicator
};

/* Standard Industrial Category Colors */
const CATEGORY_COLOR: Record<string, string> = {
  'Machine Breakdown':        '#ef4444', // Red
  'Die Breakdown':            '#ea580c', // Deep Orange
  'Minor Stoppage':           '#f59e0b', // Industrial Warning Amber
  'Robot Breakdown':          '#9333ea', // Electric Violet
  'Process Loss':             '#2563eb', // Industrial Blue
  'HPDC Machine Accessories': '#ec4899', // Hot Pink
  'Planned Downtime':         '#10b981', // Emerald Green
  'Tool / Die Change':        '#06b6d4', // Cyan
  'Management Loss':          '#64748b', // Slate Gray
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

/* ── High Contrast Industrial Tooltips ──────────────────────────── */
const ttStyle = {
  background: '#0b1329',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: '8px',
  color: '#f8fafc',
  padding: '10px 14px',
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
};
const ttItemStyle = { color: '#e2e8f0', fontSize: '12px', padding: '2px 0' };
const ttLabelStyle = { color: '#38bdf8', fontWeight: 700, fontSize: '13px', marginBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' };

/* ─── Component ───────────────────────────────────────────────── */
export const Dashboard: React.FC<DashboardProps> = ({ records, businessRange, thresholdSeconds = 300 }) => {

  /* ── computed stats ─────────────────────────────────────────── */
  const stats = useMemo(() => {
    let bdSec = 0, minSec = 0, opSec = 0;
    let bdCnt = 0, minCnt = 0, opCnt = 0;
    let docCnt = 0, pendCnt = 0;

    const hourlyMap = Array.from({ length: 24 }, () => ({
      bd: 0, min: 0, op: 0, durSec: 0,
    }));
    const dailyMap: Record<string, number> = {};
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

      // Production day: before 6am → previous calendar day
      const pd = new Date(d);
      if (pd.getHours() < 6) pd.setDate(pd.getDate() - 1);
      const dk = pd.toLocaleDateString('en-GB');
      dailyMap[dk] = (dailyMap[dk] || 0) + dur;

      // Reason label
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

    // Daily trend
    let cumAcc = 0;
    const dailyData = Object.keys(dailyMap)
      .map(dk => ({ date: dk.substring(0, 5), full: dk, hours: +(dailyMap[dk] / 3600).toFixed(2), sec: dailyMap[dk] }))
      .sort((a, b) => a.full.localeCompare(b.full))
      .map(d => { cumAcc += d.hours; return { ...d, cumulative: +cumAcc.toFixed(2) }; });

    const avgDailyHrs = dailyData.length > 0
      ? +(dailyData.reduce((s, d) => s + d.hours, 0) / dailyData.length).toFixed(2)
      : 0;

    // Worst day
    let worstDay = { full: '-', hours: 0 };
    dailyData.forEach(d => { if (d.hours > worstDay.hours) worstDay = d; });

    // Hourly (factory order 06→05)
    const factorySeq = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5];
    const hourlyData = factorySeq.map(h => {
      const hd = hourlyMap[h];
      const shiftLabel = h >= 6 && h < 14 ? 'A' : h >= 14 && h < 22 ? 'B' : 'C';
      return {
        name: `${String(h).padStart(2,'0')}:00`,
        shift: shiftLabel,
        bd: hd.bd, min: hd.min, op: hd.op,
        total: hd.bd + hd.min + hd.op,
        durSec: hd.durSec,
      };
    });

    // Peak hour
    const peakHour = hourlyData.reduce((best, d) => d.total > best.total ? d : best, { name: '-', total: 0, shift: '', bd: 0, min: 0, op: 0, durSec: 0 });

    // Shift summary & donut
    const shiftSummary = [
      { key: 'A', name: 'Shift A', timing: '06:00 – 14:00', value: +(shiftMap.A / 3600).toFixed(2), sec: shiftMap.A, fill: INDUSTRIAL_COLORS.shiftA, count: shiftCntMap.A, pct: totalSec > 0 ? Math.round((shiftMap.A / totalSec) * 100) : 0 },
      { key: 'B', name: 'Shift B', timing: '14:00 – 22:00', value: +(shiftMap.B / 3600).toFixed(2), sec: shiftMap.B, fill: INDUSTRIAL_COLORS.shiftB, count: shiftCntMap.B, pct: totalSec > 0 ? Math.round((shiftMap.B / totalSec) * 100) : 0 },
      { key: 'C', name: 'Shift C', timing: '22:00 – 06:00', value: +(shiftMap.C / 3600).toFixed(2), sec: shiftMap.C, fill: INDUSTRIAL_COLORS.shiftC, count: shiftCntMap.C, pct: totalSec > 0 ? Math.round((shiftMap.C / totalSec) * 100) : 0 },
    ];
    const shiftData = shiftSummary.filter(d => d.value > 0);

    // Top reasons (Pareto)
    const topReasons = Object.keys(reasonDur)
      .map(k => ({
        name: k.length > 24 ? k.slice(0, 24) + '…' : k,
        fullName: k,
        hours: +(reasonDur[k] / 3600).toFixed(2),
        sec: reasonDur[k],
        count: reasonCnt[k],
        pct: totalSec > 0 ? +((reasonDur[k] / totalSec) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 6);

    // Category data
    const catData = Object.entries(catMap)
      .map(([name, info]) => ({
        name: name.length > 26 ? name.slice(0, 26) + '…' : name,
        fullName: name,
        hours: +(info.sec / 3600).toFixed(2),
        sec: info.sec,
        count: info.count,
        fill: catColor(name),
      }))
      .filter(d => d.hours > 0 || d.count > 0)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 7);

    // RCA data
    const rcaData = [
      { name: 'RCA Completed', value: docCnt, fill: INDUSTRIAL_COLORS.operational },
      { name: 'Pending RCA', value: pendCnt, fill: docCnt === 0 ? INDUSTRIAL_COLORS.breakdown : INDUSTRIAL_COLORS.pendingAction },
    ].filter(d => d.value > 0);

    // Top 5 records for insight list
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

    // insights text
    const top3pct = topReasons.length >= 3
      ? +(topReasons.slice(0, 3).reduce((s, r) => s + r.pct, 0)).toFixed(0)
      : (topReasons.length > 0 ? +(topReasons.reduce((s, r) => s + r.pct, 0)).toFixed(0) : 0);

    return {
      totalSec, totalEvents, bdSec, minSec, opSec,
      bdCnt, minCnt, opCnt,
      rcaPct, pendCnt, docCnt, maxSec, avgBdSec, avgDailyHrs,
      dailyData, worstDay, hourlyData, peakHour,
      shiftData, shiftSummary, topReasons, catData, rcaData, top5,
      insights: {
        bdPct: totalSec > 0 ? +((bdSec / totalSec) * 100).toFixed(0) : 0,
        top3pct,
        pendPct: totalEvents > 0 ? +((pendCnt / totalEvents) * 100).toFixed(0) : 0,
      },
    };
  }, [records, businessRange]);

  /* ── no-data guard ──────────────────────────────────────────── */
  if (stats.totalEvents === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: '3rem' }}>📋</div>
        <p style={{ marginTop: '12px', fontSize: '1.1rem', fontWeight: 600, color: '#94a3b8' }}>
          No records found for the selected period.
        </p>
      </div>
    );
  }

  /* ── helpers inline ─────────────────────────────────────────── */
  const emptyChart = (h = 260) => (
    <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: '2rem' }}>📊</span>
      <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>No data to display</span>
    </div>
  );

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <div className="tpm-dashboard">

      {/* ── Page header ── */}
      <div className="tpm-header">
        <h1>Machine Stoppage Analytics</h1>
        <p>Live analysis of {stats.totalEvents} stoppage records — all metrics auto-calculated from event log.</p>
      </div>

      {/* ══════════════════════════════════════════════════════
          KPI CARDS (6 Industrial Status Cards)
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-kpi-grid">

        {/* 1. Total Events */}
        <div className="kpi-card color-blue">
          <div className="kpi-badge">STOPPAGES</div>
          <div className="kpi-val">{stats.totalEvents}</div>
          <div className="kpi-label">TOTAL EVENTS</div>
          <div className="kpi-sub">{stats.bdCnt} Breakdown · {stats.minCnt} Minor · {stats.opCnt} Operator</div>
        </div>

        {/* 2. Breakdown */}
        <div className="kpi-card color-red">
          <div className="kpi-badge">CRITICAL DOWNTIME</div>
          <div className="kpi-val">{stats.bdCnt}</div>
          <div className="kpi-label">BREAKDOWN (&gt; {thresholdLabel(thresholdSeconds)})</div>
          <div className="kpi-sub">{fmtShort(stats.bdSec)} lost · Avg {fmtDigital(stats.avgBdSec)} MTTR</div>
        </div>

        {/* 3. Minor Stoppage */}
        <div className="kpi-card color-orange">
          <div className="kpi-badge">SHORT IDLE</div>
          <div className="kpi-val">{stats.minCnt}</div>
          <div className="kpi-label">MINOR STOPPAGE (&lt; {thresholdLabel(thresholdSeconds)})</div>
          <div className="kpi-sub">{fmtShort(stats.minSec)} lost duration</div>
        </div>

        {/* 4. Total Downtime */}
        <div className="kpi-card color-flame">
          <div className="kpi-badge">TOTAL PRODUCTION LOSS</div>
          <div className="kpi-val">{fmtShort(stats.totalSec)}</div>
          <div className="kpi-label">TOTAL DOWNTIME</div>
          <div className="kpi-sub">Avg {stats.avgDailyHrs}h / production day</div>
        </div>

        {/* 5. Longest Stoppage */}
        <div className="kpi-card color-purple">
          <div className="kpi-badge">MAX SINGLE INCIDENT</div>
          <div className="kpi-val">{fmtShort(stats.maxSec)}</div>
          <div className="kpi-label">LONGEST STOPPAGE</div>
          <div className="kpi-sub">Worst single incident recorded</div>
        </div>

        {/* 6. RCA Completion */}
        <div className={`kpi-card ${stats.rcaPct >= 80 ? 'color-green' : stats.rcaPct >= 50 ? 'color-orange' : 'color-red'}`}>
          <div className="kpi-badge">ROOT CAUSE ACTION</div>
          <div className="kpi-val">{stats.rcaPct}%</div>
          <div className="kpi-label">RCA COMPLETION</div>
          <div className="kpi-sub">{stats.docCnt} done · {stats.pendCnt} pending action</div>
        </div>

      </div>

      {/* ══════════════════════════════════════════════════════
          AUTOMATED INDUSTRIAL INSIGHTS
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-insights-panel">
        <div className="insights-header">
          <span className="insights-icon">📊</span>
          <h3>Key Insights &amp; Operational Priorities</h3>
        </div>
        <ul className="insights-list">
          <li>
            <span className="insight-tag tag-breakdown">BREAKDOWN IMPACT</span>
            <span>
              <strong>Breakdown</strong> accounts for <strong>{stats.insights.bdPct}%</strong> of total downtime ({fmtShort(stats.bdSec)}) across <strong>{stats.bdCnt}</strong> events.
            </span>
          </li>
          <li>
            <span className="insight-tag tag-pareto">PARETO 80/20</span>
            <span>
              Top {stats.topReasons.length >= 3 ? '3' : stats.topReasons.length} stoppage causes contribute <strong>{stats.insights.top3pct}%</strong> of all logged downtime — fixing these root causes will deliver the maximum improvement.
            </span>
          </li>
          <li>
            <span className="insight-tag tag-rca">ACTION NEEDED</span>
            <span>
              <strong>{stats.insights.pendPct}%</strong> of events (<strong>{stats.pendCnt}</strong> of {stats.totalEvents}) have <strong style={{ color: '#ea580c' }}>no RCA completed</strong>. Prioritise investigating high-duration incidents first.
            </span>
          </li>
          {stats.peakHour.total > 0 && (
            <li>
              <span className="insight-tag tag-peak">PEAK DISRUPTION</span>
              <span>
                Peak disruption hour: <strong>{stats.peakHour.name}</strong> (Shift {stats.peakHour.shift}) with <strong>{stats.peakHour.total}</strong> stoppages — investigate shift-change activity and loading patterns.
              </span>
            </li>
          )}
          {stats.worstDay.hours > 0 && (
            <li>
              <span className="insight-tag tag-worst">WORST DAY</span>
              <span>
                <strong style={{ color: '#ef4444' }}>{stats.worstDay.full}</strong> was the worst production day with <strong>{stats.worstDay.hours}h</strong> ({fmtShort(stats.worstDay.hours * 3600)}) of downtime — highlighted in red on the daily chart.
              </span>
            </li>
          )}
        </ul>
      </div>

      {/* ══════════════════════════════════════════════════════
          CHARTS ROW 1 — Daily Trend + Shift Donut
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-charts-layout">

        {/* ── Chart 1: Daily Downtime Trend bar chart ── */}
        <div className="chart-box col-7">
          <div className="chart-box-header">
            <span className="chart-box-badge badge-amber">TIMELINE ANALYSIS</span>
            <h4>Daily Downtime Trend &amp; Cumulative Loss</h4>
            <p className="chart-sub">
              Production Day Average: <strong>{stats.avgDailyHrs}h / day</strong>
              {stats.worstDay.hours > 0 && stats.dailyData.length > 1 && (
                <span className="chart-worst-badge">
                  ● Highest Loss: {stats.worstDay.full} ({stats.worstDay.hours}h)
                </span>
              )}
            </p>
          </div>

          {stats.dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={290}>
              <ComposedChart data={stats.dailyData} margin={{ top: 25, right: 30, left: 10, bottom: 15 }}>
                <defs>
                  {/* Rich Industrial Amber Gradient */}
                  <linearGradient id="barGradDaily" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#b45309" stopOpacity={0.9} />
                  </linearGradient>
                  {/* Critical Safety Red for Worst Day */}
                  <linearGradient id="barGradDailyWorst" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                    <stop offset="100%" stopColor="#991b1b" stopOpacity={0.9} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255, 255, 255, 0.12)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#e2e8f0', fontSize: 12, fontWeight: 600 }}
                  axisLine={{ stroke: '#475569' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 500 }}
                  axisLine={{ stroke: '#475569' }}
                  tickLine={false}
                  label={{ value: 'Downtime (Hours)', angle: -90, position: 'insideLeft', fill: '#f59e0b', fontSize: 12, fontWeight: 600, offset: 12 }}
                />

                <RechartsTooltip
                  contentStyle={ttStyle}
                  itemStyle={ttItemStyle}
                  labelStyle={ttLabelStyle}
                  formatter={(v: any, name: any, item: any) => [
                    `${v}h (${fmtShort(item.payload.sec || Number(v) * 3600)})`,
                    name === 'hours' ? 'Daily Downtime' : 'Cumulative Downtime'
                  ]}
                />

                <Legend
                  align="center"
                  verticalAlign="top"
                  height={34}
                  iconType="circle"
                  wrapperStyle={{ fontSize: '12px', color: '#e2e8f0', paddingBottom: '10px' }}
                />

                <Bar
                  isAnimationActive={false}
                  dataKey="hours"
                  name="Downtime (h)"
                  radius={[6, 6, 0, 0]}
                  barSize={stats.dailyData.length <= 2 ? 52 : stats.dailyData.length <= 6 ? 38 : 24}
                >
                  {stats.dailyData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.full === stats.worstDay.full && stats.dailyData.length > 1 ? 'url(#barGradDailyWorst)' : 'url(#barGradDaily)'}
                    />
                  ))}
                  <LabelList
                    dataKey="hours"
                    position="top"
                    fill="#fef08a"
                    fontSize={12}
                    fontWeight={700}
                    offset={8}
                    formatter={(v: any) => v > 0 ? `${v}h` : ''}
                  />
                </Bar>

                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="cumulative"
                  name="Cumulative (h)"
                  stroke={INDUSTRIAL_COLORS.cumulativeLine}
                  strokeWidth={3}
                  dot={{ r: 5, fill: '#0b1329', stroke: INDUSTRIAL_COLORS.cumulativeLine, strokeWidth: 2.5 }}
                  activeDot={{ r: 7, fill: INDUSTRIAL_COLORS.cumulativeLine }}
                >
                  <LabelList
                    dataKey="cumulative"
                    position="top"
                    fill="#7dd3fc"
                    fontSize={11}
                    fontWeight={600}
                    offset={10}
                    formatter={(v: any) => stats.dailyData.length > 1 && v > 0 ? `${v}h` : ''}
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          ) : emptyChart(290)}
        </div>

        {/* ── Chart 2: Shift distribution donut ── */}
        <div className="chart-box col-5">
          <div className="chart-box-header">
            <span className="chart-box-badge badge-blue">SHIFT ALLOCATION</span>
            <h4>Downtime by Shift</h4>
            <p className="chart-sub">Loss Breakdown across Production Shifts</p>
          </div>

          {stats.shiftSummary.some(s => s.value > 0) ? (
            <>
              <div style={{ position: 'relative', height: 195 }}>
                <ResponsiveContainer width="100%" height={195}>
                  <PieChart>
                    <Pie
                      isAnimationActive={false}
                      data={stats.shiftData}
                      cx="50%"
                      cy="50%"
                      innerRadius={62}
                      outerRadius={92}
                      dataKey="value"
                      stroke="#0b1329"
                      strokeWidth={3}
                      paddingAngle={stats.shiftData.length > 1 ? 4 : 0}
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
                        `${v}h (${fmtShort(item.payload.sec || Number(v) * 3600)}) · ${item.payload.count || 0} events (${item.payload.pct || 0}%)`,
                        item.payload.name || name
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Donut Center Key Metric */}
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>
                    TOTAL LOSS
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', lineHeight: 1.15, marginTop: 2 }}>
                    {fmtShort(stats.totalSec)}
                  </div>
                  <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, marginTop: 2 }}>
                    {stats.shiftData[0] ? `${stats.shiftData[0].name} (${stats.shiftData[0].pct}%)` : ''}
                  </div>
                </div>
              </div>

              {/* Shift Detail Cards */}
              <div className="shift-pills-row">
                {stats.shiftSummary.map((s, i) => (
                  <div key={i} className={`shift-pill-card ${s.value > 0 ? 'active' : 'idle'}`} style={{ borderTop: `3px solid ${s.fill}` }}>
                    <div className="shift-pill-name" style={{ color: s.fill }}>
                      <span className="shift-pill-dot" style={{ backgroundColor: s.fill }}></span>
                      {s.name}
                    </div>
                    <div className="shift-pill-timing">{s.timing}</div>
                    <div className="shift-pill-val">{s.value > 0 ? `${s.value}h` : '0h'}</div>
                    <div className="shift-pill-time">
                      {s.count > 0 ? `${s.count} events (${s.pct}%)` : '0 events (0%)'}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : emptyChart(260)}
        </div>

        {/* ══════════════════════════════════════════════════════
            CHARTS ROW 2 — Top Reasons + Category
        ══════════════════════════════════════════════════════ */}

        {/* ── Chart 3: Top Stoppage Reasons (Pareto) ── */}
        <div className="chart-box col-7">
          <div className="chart-box-header">
            <span className="chart-box-badge badge-red">PARETO ANALYSIS (80/20)</span>
            <h4>Top Stoppage Root Causes</h4>
            <p className="chart-sub">Downtime Hours (Left Axis, Bars) vs Incident Frequency (Right Axis, Line)</p>
          </div>

          {stats.topReasons.length > 0 ? (
            <ResponsiveContainer width="100%" height={310}>
              <ComposedChart data={stats.topReasons} margin={{ top: 25, right: 35, left: 10, bottom: 50 }}>
                <defs>
                  {/* Safety Red for Pareto bars */}
                  <linearGradient id="barGradReason" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                    <stop offset="100%" stopColor="#b91c1c" stopOpacity={0.9} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255, 255, 255, 0.12)" />

                <XAxis
                  dataKey="name"
                  tick={{ fill: '#e2e8f0', fontSize: 11.5, fontWeight: 600 }}
                  axisLine={{ stroke: '#475569' }}
                  tickLine={false}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={55}
                />

                <YAxis
                  yAxisId="left"
                  tick={{ fill: '#f87171', fontSize: 12, fontWeight: 600 }}
                  axisLine={{ stroke: '#475569' }}
                  tickLine={false}
                  label={{ value: 'Downtime (Hours)', angle: -90, position: 'insideLeft', fill: '#f87171', fontSize: 12, fontWeight: 700, offset: 12 }}
                />

                <YAxis
                  yAxisId="right"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: '#22d3ee', fontSize: 12, fontWeight: 600 }}
                  axisLine={{ stroke: '#475569' }}
                  tickLine={false}
                  label={{ value: 'Incident Count', angle: 90, position: 'insideRight', fill: '#22d3ee', fontSize: 12, fontWeight: 700, offset: 12 }}
                />

                <RechartsTooltip
                  contentStyle={ttStyle}
                  itemStyle={ttItemStyle}
                  labelStyle={ttLabelStyle}
                  formatter={(v: any, name: any, item: any) => [
                    name === 'hours' || name === 'Downtime (h)'
                      ? `${v}h (${fmtShort(item.payload.sec || Number(v) * 3600)}) · ${item.payload.pct}% total`
                      : `${v} incidents`,
                    name === 'hours' ? 'Downtime Lost' : 'Incidents'
                  ]}
                  labelFormatter={(_: any, payload: any[]) => payload?.[0]?.payload?.fullName || _}
                />

                <Legend
                  align="center"
                  verticalAlign="top"
                  height={34}
                  iconType="circle"
                  wrapperStyle={{ fontSize: '12px', color: '#e2e8f0', paddingBottom: '10px' }}
                />

                <Bar
                  isAnimationActive={false}
                  yAxisId="left"
                  dataKey="hours"
                  name="Downtime (h)"
                  fill="url(#barGradReason)"
                  radius={[6, 6, 0, 0]}
                  barSize={stats.topReasons.length <= 2 ? 52 : 36}
                >
                  <LabelList
                    dataKey="hours"
                    position="top"
                    fill="#fca5a5"
                    fontSize={12}
                    fontWeight={700}
                    offset={8}
                    formatter={(v: any) => v > 0 ? `${v}h` : ''}
                  />
                </Bar>

                <Line
                  isAnimationActive={false}
                  yAxisId="right"
                  type="monotone"
                  dataKey="count"
                  name="Incidents"
                  stroke={INDUSTRIAL_COLORS.incidentLine}
                  strokeWidth={3}
                  dot={{ r: 5, fill: '#0b1329', stroke: INDUSTRIAL_COLORS.incidentLine, strokeWidth: 2.5 }}
                  activeDot={{ r: 7, fill: INDUSTRIAL_COLORS.incidentLine }}
                >
                  <LabelList
                    dataKey="count"
                    position="top"
                    fill="#67e8f9"
                    fontSize={12}
                    fontWeight={700}
                    offset={10}
                    formatter={(v: any) => v > 0 ? `${v} inc` : ''}
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          ) : emptyChart(310)}
        </div>

        {/* ── Chart 4: Downtime by Loss Category ── */}
        <div className="chart-box col-5">
          <div className="chart-box-header">
            <span className="chart-box-badge badge-orange">LOSS CLASSIFICATION</span>
            <h4>Downtime by Category</h4>
            <p className="chart-sub">Industrial Stoppage Classification (Hours &amp; Events)</p>
          </div>

          {stats.catData.length > 0 ? (
            <ResponsiveContainer width="100%" height={310}>
              <BarChart
                data={stats.catData}
                layout="vertical"
                margin={{ top: 15, right: 60, left: 15, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255, 255, 255, 0.12)" />
                <XAxis
                  type="number"
                  tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 500 }}
                  axisLine={{ stroke: '#475569' }}
                  tickLine={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fill: '#f8fafc', fontSize: 12, fontWeight: 600 }}
                  axisLine={{ stroke: '#475569' }}
                  tickLine={false}
                  width={155}
                />
                <RechartsTooltip
                  contentStyle={ttStyle}
                  itemStyle={ttItemStyle}
                  labelStyle={ttLabelStyle}
                  formatter={(v: any, _: any, item: any) => [
                    `${v}h (${fmtShort(item.payload.sec || Number(v) * 3600)}) · ${item.payload.count} events`,
                    'Downtime Loss'
                  ]}
                  labelFormatter={(_: any, payload: any[]) => payload?.[0]?.payload?.fullName || _}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="hours"
                  name="Downtime"
                  radius={[0, 6, 6, 0]}
                  barSize={stats.catData.length <= 2 ? 34 : stats.catData.length <= 4 ? 26 : 20}
                >
                  {stats.catData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                  <LabelList
                    dataKey="hours"
                    position="right"
                    fill="#f8fafc"
                    fontSize={11.5}
                    fontWeight={700}
                    offset={8}
                    formatter={(v: any, item: any) => {
                      const count = (item as any)?.payload?.count || 0;
                      return v > 0 ? `${v}h (${count} inc)` : `${count} inc`;
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : emptyChart(310)}
        </div>

        {/* ══════════════════════════════════════════════════════
            CHARTS ROW 3 — Hourly rhythm + RCA Compliance
        ══════════════════════════════════════════════════════ */}

        {/* ── Chart 5: 24-hour production rhythm ── */}
        <div className="chart-box col-7">
          <div className="chart-box-header">
            <span className="chart-box-badge badge-purple">PRODUCTION RHYTHM</span>
            <h4>24-Hour Production Rhythm</h4>
            <p className="chart-sub">
              Factory Day Cycle (06:00 AM → 06:00 AM Next Day)
              {stats.peakHour.total > 0 && (
                <span className="chart-worst-badge" style={{ marginLeft: 8 }}>
                  ⚡ Peak: {stats.peakHour.name} ({stats.peakHour.total} stoppages, Shift {stats.peakHour.shift})
                </span>
              )}
            </p>
          </div>

          {/* Shift Time Demarcation Indicators */}
          <div className="hourly-shift-timeline">
            <div className="hourly-shift-segment shift-a-segment">
              <span className="shift-seg-dot" style={{ background: INDUSTRIAL_COLORS.shiftA }}></span>
              <strong>Shift A</strong> (06:00 – 14:00)
            </div>
            <div className="hourly-shift-segment shift-b-segment">
              <span className="shift-seg-dot" style={{ background: INDUSTRIAL_COLORS.shiftB }}></span>
              <strong>Shift B</strong> (14:00 – 22:00)
            </div>
            <div className="hourly-shift-segment shift-c-segment">
              <span className="shift-seg-dot" style={{ background: INDUSTRIAL_COLORS.shiftC }}></span>
              <strong>Shift C</strong> (22:00 – 06:00)
            </div>
          </div>

          <ResponsiveContainer width="100%" height={270}>
            <AreaChart data={stats.hourlyData} margin={{ top: 15, right: 30, left: 10, bottom: 15 }}>
              <defs>
                {/* Breakdown Red Gradient */}
                <linearGradient id="gradBd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={INDUSTRIAL_COLORS.breakdown} stopOpacity={0.70} />
                  <stop offset="95%" stopColor={INDUSTRIAL_COLORS.breakdown} stopOpacity={0.05} />
                </linearGradient>
                {/* Minor Stoppage Amber Gradient */}
                <linearGradient id="gradMin" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={INDUSTRIAL_COLORS.minor} stopOpacity={0.65} />
                  <stop offset="95%" stopColor={INDUSTRIAL_COLORS.minor} stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255, 255, 255, 0.12)" />
              <XAxis
                dataKey="name"
                tick={{ fill: '#e2e8f0', fontSize: 11, fontWeight: 600 }}
                axisLine={{ stroke: '#475569' }}
                tickLine={false}
                interval={1}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 500 }}
                axisLine={{ stroke: '#475569' }}
                tickLine={false}
                label={{ value: 'Incidents', angle: -90, position: 'insideLeft', fill: '#cbd5e1', fontSize: 12, fontWeight: 600, offset: 12 }}
              />

              <RechartsTooltip
                contentStyle={ttStyle}
                itemStyle={ttItemStyle}
                labelStyle={ttLabelStyle}
                formatter={(v: any, name: any, item: any) => [
                  `${v} incidents (Shift ${item.payload.shift})`,
                  name === 'bd' ? 'Breakdown (>2m)' : 'Minor Stoppage (<2m)'
                ]}
              />

              <Legend
                align="center"
                verticalAlign="top"
                height={32}
                iconType="circle"
                wrapperStyle={{ fontSize: '12px', color: '#e2e8f0', paddingBottom: '8px' }}
              />

              <Area
                isAnimationActive={false}
                type="monotone"
                dataKey="bd"
                name="Breakdown"
                stroke={INDUSTRIAL_COLORS.breakdown}
                strokeWidth={3}
                fill="url(#gradBd)"
                dot={{ r: 4, fill: INDUSTRIAL_COLORS.breakdown, stroke: '#0b1329', strokeWidth: 1.5 }}
                activeDot={{ r: 6 }}
              />

              <Area
                isAnimationActive={false}
                type="monotone"
                dataKey="min"
                name="Minor Stoppage"
                stroke={INDUSTRIAL_COLORS.minor}
                strokeWidth={3}
                fill="url(#gradMin)"
                dot={{ r: 4, fill: INDUSTRIAL_COLORS.minor, stroke: '#0b1329', strokeWidth: 1.5 }}
                activeDot={{ r: 6 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* ── Chart 6: RCA compliance donut ── */}
        <div className="chart-box col-5">
          <div className="chart-box-header">
            <span className="chart-box-badge badge-green">TPM GOVERNANCE</span>
            <h4>RCA Action Compliance</h4>
            <p className="chart-sub">Plant Standard Target: ≥ 80% Stoppages Documented</p>
          </div>

          <div style={{ position: 'relative', height: 185 }}>
            <ResponsiveContainer width="100%" height={185}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={stats.rcaData}
                  cx="50%"
                  cy="50%"
                  innerRadius={62}
                  outerRadius={92}
                  paddingAngle={stats.rcaData.length > 1 ? 4 : 0}
                  dataKey="value"
                  labelLine={false}
                  stroke="#0b1329"
                  strokeWidth={3}
                >
                  {stats.rcaData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={ttStyle}
                  itemStyle={ttItemStyle}
                  labelStyle={ttLabelStyle}
                  formatter={(v: any, name: any) => [
                    `${v} events (${totalEventsCalc(stats.totalEvents, Number(v))}%)`,
                    name
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Compliance Gauge Center Metric */}
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{
                fontSize: 28,
                fontWeight: 800,
                color: stats.rcaPct >= 80 ? '#10b981' : stats.rcaPct >= 50 ? '#f59e0b' : '#ef4444',
                lineHeight: 1
              }}>
                {stats.rcaPct}%
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginTop: 4 }}>
                RCA DONE
              </div>
            </div>
          </div>

          {/* RCA Target Banner */}
          <div className="rca-target-banner">
            <div className="rca-meta-row">
              <span className="rca-target-label">
                Benchmark Target: <strong>80% Documented</strong>
              </span>
              <span className={`rca-target-badge ${stats.rcaPct >= 80 ? 'achieved' : 'missed'}`}>
                {stats.rcaPct >= 80 ? '✓ Target Met' : '⚠ Action Required'}
              </span>
            </div>

            <div className="rca-progress-track">
              <div
                className="rca-progress-bar"
                style={{
                  width: `${Math.min(100, stats.rcaPct)}%`,
                  backgroundColor: stats.rcaPct >= 80 ? '#10b981' : stats.rcaPct >= 50 ? '#f59e0b' : '#ef4444',
                }}
              />
              <div className="rca-progress-target-line" style={{ left: '80%' }} title="Target 80%" />
            </div>

            <div className="rca-stats-footer">
              <span style={{ color: '#10b981', fontWeight: 700 }}>✓ {stats.docCnt} Documented ({stats.rcaPct}%)</span>
              <span style={{ color: '#64748b' }}>·</span>
              <span style={{ color: stats.pendCnt > 0 ? '#ea580c' : '#94a3b8', fontWeight: 700 }}>
                ⏳ {stats.pendCnt} Pending Action ({100 - stats.rcaPct}%)
              </span>
            </div>
          </div>
        </div>

      </div>{/* end charts layout */}

      {/* ══════════════════════════════════════════════════════
          TOP 5 CRITICAL INCIDENTS TABLE
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-table-section" style={{ marginTop: '32px' }}>
        <div className="tpm-section-header">
          <span className="chart-box-badge badge-red">CRITICAL EVENT LOG</span>
          <h4 style={{ fontSize: '18px', fontWeight: 700, margin: '4px 0 2px 0' }}>Top 5 Longest Stoppages</h4>
          <p className="chart-sub">Ranked by lost duration · High-priority investigation targets</p>
        </div>

        <div className="table-responsive">
          <table className="tpm-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Rank</th>
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
                    <span style={{ fontWeight: 800, color: item.rank === 1 ? '#ef4444' : '#f8fafc', fontSize: '14px' }}>
                      #{item.rank}
                    </span>
                  </td>
                  <td style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{item.date}</td>
                  <td>
                    <span className={`tpm-badge ${item.isBd ? 'danger' : 'warning'}`}>
                      {item.category}
                    </span>
                  </td>
                  <td className="dur" style={{ color: '#f8fafc', fontWeight: 800, fontSize: '14px', fontFamily: 'monospace' }}>
                    {item.duration}
                  </td>
                  <td className="reason-col" style={{ fontSize: '13px', fontWeight: 500 }}>
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

      {/* ══════════════════════════════════════════════════════
          METHODOLOGY FOOTNOTE
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-methodology">
        <details>
          <summary>Plant Calculation Standards &amp; Formulae</summary>
          <div className="details-content">
            <p><strong>Production Day:</strong> Runs from 06:00 AM → 06:00 AM next morning. Events between 00:00 and 05:59 belong to previous production day.</p>
            <p><strong>Shift Segments:</strong> Shift A = 06:00–14:00 · Shift B = 14:00–22:00 · Shift C = 22:00–06:00.</p>
            <p><strong>Total Downtime:</strong> Sum of event durations across all logged stoppage records within the selected date &amp; shift filters.</p>
            <p><strong>Breakdown vs Minor:</strong> Stoppages exceeding {thresholdLabel(thresholdSeconds)} are classified as Critical Breakdown (MTTR tracked); shorter are Minor Stoppages.</p>
            <p><strong>RCA Compliance:</strong> % of stoppage records with confirmed Root Cause and corrective action submitted.</p>
          </div>
        </details>
      </div>

    </div>
  );
};

function totalEventsCalc(total: number, part: number) {
  if (!total || total <= 0) return 0;
  return Math.round((part / total) * 100);
}
