import React, { useMemo } from 'react';
import { RecordingRecord } from './api';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Legend, LabelList, ComposedChart, Line, Area, AreaChart,
} from 'recharts';

interface DashboardProps {
  records: RecordingRecord[];
}

/* ─── Colour tokens ───────────────────────────────────────────── */
const C = {
  breakdown:   '#ef4444',
  minor:       '#f59e0b',
  operator:    '#3b82f6',
  documented:  '#22c55e',
  pending:     '#fb923c',
  noRca:       '#64748b',
  shiftA:      '#8b5cf6',
  shiftB:      '#10b981',
  shiftC:      '#f43f5e',
};

const CATEGORY_COLOR: Record<string, string> = {
  'Machine Breakdown':        '#ef4444',
  'Die Breakdown':            '#f97316',
  'Robot Breakdown':          '#a855f7',
  'Process Loss':             '#3b82f6',
  'Management Loss':          '#64748b',
  'Planned Downtime':         '#22c55e',
  'HPDC Machine Accessories': '#ec4899',
};
const catColor = (name: string) => CATEGORY_COLOR[name] || '#6366f1';

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
function evtDur(r: RecordingRecord) {
  return r.event_duration_seconds || r.duration_seconds || 0;
}
function hasRca(r: RecordingRecord) {
  const reason = (r.reason || r.manual_transcript || '').trim();
  return !(!reason || reason.toLowerCase() === 'pending reason');
}

const ttStyle = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f8fafc',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};
const ttItemStyle = { color: '#e2e8f0', fontSize: '12px' };
const ttLabelStyle = { color: '#f8fafc', fontWeight: 600, fontSize: '13px', marginBottom: 4 };

/* ─── Component ───────────────────────────────────────────────── */
export const Dashboard: React.FC<DashboardProps> = ({ records }) => {

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
    const reasonDur: Record<string, number> = {};
    const reasonCnt: Record<string, number> = {};
    const catMap: Record<string, { sec: number; count: number }> = {};

    const valid = records.filter(r => r.started_at);

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
      .map(dk => ({ date: dk.substring(0, 5), full: dk, hours: +(dailyMap[dk] / 3600).toFixed(2) }))
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
      };
    });

    // Peak hour
    const peakHour = hourlyData.reduce((best, d) => d.total > best.total ? d : best, { name: '-', total: 0, shift: '', bd: 0, min: 0, op: 0 });

    // Shift donuts
    const shiftData = [
      { name: 'Shift A (6–14h)', value: +(shiftMap.A / 3600).toFixed(2), fill: C.shiftA,
        count: valid.filter(r => { const d = new Date(r.started_at as string); const t = d.getHours() + d.getMinutes()/60; return t>=6&&t<14; }).length },
      { name: 'Shift B (14–22h)', value: +(shiftMap.B / 3600).toFixed(2), fill: C.shiftB,
        count: valid.filter(r => { const d = new Date(r.started_at as string); const t = d.getHours() + d.getMinutes()/60; return t>=14&&t<22; }).length },
      { name: 'Shift C (22–6h)',  value: +(shiftMap.C / 3600).toFixed(2), fill: C.shiftC,
        count: valid.filter(r => { const d = new Date(r.started_at as string); const t = d.getHours() + d.getMinutes()/60; return t>=22||t<6; }).length },
    ].filter(d => d.value > 0);

    // Top reasons
    const topReasons = Object.keys(reasonDur)
      .map(k => ({
        name: k.length > 20 ? k.slice(0,20) + '…' : k,
        fullName: k,
        hours: +(reasonDur[k] / 3600).toFixed(2),
        count: reasonCnt[k],
        pct: totalSec > 0 ? +((reasonDur[k] / totalSec) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 6);

    // Category data
    const catData = Object.entries(catMap)
      .map(([name, info]) => ({
        name: name.length > 22 ? name.slice(0,22)+'…' : name,
        hours: +(info.sec / 3600).toFixed(2),
        count: info.count,
        fill: catColor(name),
      }))
      .filter(d => d.hours > 0)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 6);

    // RCA data
    const rcaData = [
      { name: 'RCA Done',     value: docCnt,  fill: C.documented },
      { name: 'Pending RCA',  value: pendCnt, fill: C.pending    },
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
          category: r.reason_category || (r.event_type === 'breakdown' ? 'Breakdown' : 'Minor Stoppage'),
          reason: (r.reason || 'Pending reason').split(' - ').pop() || 'Pending reason',
          rca: hasRca(r),
          isBd: r.event_type === 'breakdown',
        };
      });

    // insights text
    const top3pct = topReasons.length >= 3
      ? +(topReasons.slice(0,3).reduce((s,r) => s + r.pct, 0)).toFixed(0)
      : 0;

    return {
      totalSec, totalEvents, bdSec, minSec, opSec,
      bdCnt, minCnt, opCnt,
      rcaPct, pendCnt, docCnt, maxSec, avgBdSec, avgDailyHrs,
      dailyData, worstDay, hourlyData, peakHour,
      shiftData, topReasons, catData, rcaData, top5,
      insights: {
        bdPct: totalSec > 0 ? +((bdSec/totalSec)*100).toFixed(0) : 0,
        top3pct,
        pendPct: totalEvents > 0 ? +((pendCnt/totalEvents)*100).toFixed(0) : 0,
      },
    };
  }, [records]);

  /* ── no-data guard ──────────────────────────────────────────── */
  if (stats.totalEvents === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: '#475569' }}>
        <div style={{ fontSize: '3rem' }}>📋</div>
        <p style={{ marginTop: '12px', fontSize: '1rem' }}>No records found for the selected period.</p>
      </div>
    );
  }

  /* ── helpers inline ─────────────────────────────────────────── */
  const emptyChart = (h = 200) => (
    <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: '2rem' }}>📋</span>
      <span style={{ fontSize: '0.85rem' }}>No data to display</span>
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
          KPI CARDS (6 cards)
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-kpi-grid">

        <div className="kpi-card color-red">
          <div className="kpi-val">{fmtShort(stats.totalSec)}</div>
          <div className="kpi-label">Total Downtime</div>
          <div className="kpi-sub">Avg {stats.avgDailyHrs}h / production day</div>
        </div>

        <div className="kpi-card color-blue">
          <div className="kpi-val">{stats.totalEvents}</div>
          <div className="kpi-label">Total Stoppage Events</div>
          <div className="kpi-sub">{stats.bdCnt} Breakdown · {stats.minCnt} Minor · {stats.opCnt} Operator</div>
        </div>

        <div className="kpi-card color-orange">
          <div className="kpi-val">{fmtDigital(stats.avgBdSec)}</div>
          <div className="kpi-label">Avg Breakdown Duration</div>
          <div className="kpi-sub">Per breakdown event (MTTR)</div>
        </div>

        <div className="kpi-card color-purple">
          <div className="kpi-val">{fmtShort(stats.maxSec)}</div>
          <div className="kpi-label">Longest Single Stoppage</div>
          <div className="kpi-sub">Worst single incident recorded</div>
        </div>

        <div className="kpi-card color-green">
          <div className="kpi-val">{stats.rcaPct}%</div>
          <div className="kpi-label">RCA Completion</div>
          <div className="kpi-sub">{stats.docCnt} of {stats.totalEvents} events documented</div>
        </div>

        <div className="kpi-card" style={{ borderColor: stats.pendCnt > 10 ? '#ef4444' : '#f59e0b', background: 'rgba(239,68,68,0.07)' }}>
          <div className="kpi-val" style={{ color: stats.pendCnt > 10 ? '#ef4444' : '#f59e0b' }}>{stats.pendCnt}</div>
          <div className="kpi-label" style={{ color: '#94a3b8' }}>Pending RCA Actions</div>
          <div className="kpi-sub" style={{ color: stats.pendCnt > 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
            {stats.pendCnt > 0 ? '⚠ Action required' : '✓ All cleared'}
          </div>
        </div>

      </div>

      {/* ══════════════════════════════════════════════════════
          AUTOMATED INSIGHTS
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-insights-panel">
        <h3>📊 Key Insights</h3>
        <ul>
          <li>
            <span style={{ color: C.breakdown, fontWeight: 'bold' }}>Breakdown</span> accounts for&nbsp;
            <strong>{stats.insights.bdPct}%</strong> of total downtime ({fmtShort(stats.bdSec)}) across&nbsp;
            <strong>{stats.bdCnt}</strong> events.
          </li>
          <li>
            Top 3 stoppage causes contribute <strong>{stats.insights.top3pct}%</strong> of all logged downtime —
            fixing these root causes will deliver the maximum improvement.
          </li>
          <li>
            <strong>{stats.insights.pendPct}%</strong> of events (<strong>{stats.pendCnt}</strong> of {stats.totalEvents}) have
            <strong style={{ color: C.pending }}> no RCA completed</strong>. Prioritise investigating high-duration incidents first.
          </li>
          {stats.peakHour.total > 0 && (
            <li>
              Peak disruption hour: <strong>{stats.peakHour.name}</strong> (Shift {stats.peakHour.shift}) with&nbsp;
              <strong>{stats.peakHour.total}</strong> stoppages — investigate shift-change activity and loading patterns.
            </li>
          )}
          {stats.worstDay.hours > 0 && (
            <li>
              <strong style={{ color: '#ef4444' }}>{stats.worstDay.full}</strong> was the worst production day with&nbsp;
              <strong>{stats.worstDay.hours}h</strong> of downtime — highlighted in red on the daily chart.
            </li>
          )}
        </ul>
      </div>

      {/* ══════════════════════════════════════════════════════
          CHARTS ROW 1 — Daily Trend + Shift Donut
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-charts-layout">

        {/* Daily Trend bar chart */}
        <div className="chart-box col-7">
          <div className="chart-box-header">
            <div>
              <h4>Daily Downtime Trend
                {stats.worstDay.hours > 0 && stats.dailyData.length > 1 && (
                  <span style={{ marginLeft: 10, fontSize: '0.75rem', color: '#ef4444', fontWeight: 700, background: 'rgba(239,68,68,0.12)', padding: '2px 8px', borderRadius: 20, border: '1px solid rgba(239,68,68,0.25)' }}>
                    ● Worst: {stats.worstDay.full} ({stats.worstDay.hours}h)
                  </span>
                )}
              </h4>
              <p className="chart-sub">Production day 06:00–06:00 · Avg {stats.avgDailyHrs}h/day</p>
            </div>
          </div>
          {stats.dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={stats.dailyData}>
                <defs>
                  <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false}
                  label={{ value: 'Hours', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 10, offset: 10 }} />
                <RechartsTooltip
                  contentStyle={ttStyle}
                  itemStyle={{ color: '#e2e8f0' }}
                  labelStyle={{ color: '#f8fafc', fontWeight: 600, marginBottom: 4 }}
                  formatter={(v: any, name: any) => [`${v}h`, name]}
                />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }} />
                <Bar isAnimationActive={false} dataKey="hours" name="Downtime (h)" fill="#fbbf24" radius={[5,5,0,0]} maxBarSize={40}>
                  {stats.dailyData.map((d, i) => (
                    <Cell key={i} fill={d.full === stats.worstDay.full && stats.dailyData.length > 1 ? '#ef4444' : '#fbbf24'} />
                  ))}
                  <LabelList dataKey="hours" position="top" fill="#cbd5e1" fontSize={11} formatter={(v: any) => v > 0 ? `${v}h` : ''} />
                </Bar>
                <Line isAnimationActive={false} type="monotone" dataKey="cumulative" name="Cumulative (h)" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3, fill: '#38bdf8' }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : emptyChart(240)}
        </div>

        {/* Shift distribution donut */}
        <div className="chart-box col-5">
          <div className="chart-box-header">
            <div>
              <h4>Downtime by Shift</h4>
              <p className="chart-sub">A: 06–14h · B: 14–22h · C: 22–06h</p>
            </div>
          </div>
          {stats.shiftData.length > 0 ? (
            <>
              <div style={{ position: 'relative' }}>
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie isAnimationActive={false} data={stats.shiftData}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={72}
                      paddingAngle={4} dataKey="value" labelLine={false}
                    >
                      {stats.shiftData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <RechartsTooltip contentStyle={ttStyle} itemStyle={ttItemStyle} labelStyle={ttLabelStyle} formatter={(v: any, name: any) => [`${v}h`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9' }}>{+(stats.totalSec/3600).toFixed(1)}h</div>
                  <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px' }}>total</div>
                </div>
              </div>
              <div className="shift-pills-row">
                {stats.shiftData.map((s, i) => (
                  <div key={i} className="shift-pill-card">
                    <div className="shift-pill-name" style={{ color: s.fill }}>{s.name.split(' ')[0]} {s.name.split(' ')[1]}</div>
                    <div className="shift-pill-val">{s.value}h</div>
                    <div className="shift-pill-time">{s.count} events</div>
                  </div>
                ))}
              </div>
            </>
          ) : emptyChart(220)}
        </div>

        {/* ── CHARTS ROW 2 — Top Reasons + Category ── */}

        {/* Top Stoppage Reasons bar */}
        <div className="chart-box col-7">
          <div className="chart-box-header">
            <div>
              <h4>Top Stoppage Reasons — Downtime &amp; Frequency</h4>
              <p className="chart-sub">🟥 Bar = Downtime Hours · 🔵 Line = Incident Count</p>
            </div>
          </div>
          {stats.topReasons.length > 0 ? (
            <ResponsiveContainer width="100%" height={270}>
              <ComposedChart data={stats.topReasons}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#334155' }} tickLine={false}
                  interval={0} angle={-14} textAnchor="end" height={52} />
                <YAxis yAxisId="left"  tick={{ fill: '#ef4444', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false}
                  label={{ value: 'Hours', angle: -90, position: 'insideLeft', fill: '#ef4444', fontSize: 10, offset: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#38bdf8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false}
                  label={{ value: 'Count', angle: 90, position: 'insideRight', fill: '#38bdf8', fontSize: 10, offset: 5 }} />
                <RechartsTooltip contentStyle={ttStyle} itemStyle={ttItemStyle} labelStyle={ttLabelStyle} />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }} />
                <Bar isAnimationActive={false} yAxisId="left" dataKey="hours" name="Downtime (h)" fill="#ef4444" radius={[5,5,0,0]} maxBarSize={36}>
                  <LabelList dataKey="hours" position="top" fill="#fca5a5" fontSize={10} formatter={(v: any) => v > 0 ? `${v}h` : ''} />
                </Bar>
                <Line isAnimationActive={false} yAxisId="right" type="monotone" dataKey="count" name="Incidents" stroke="#38bdf8" strokeWidth={2.2}
                  dot={{ r: 4, fill: '#38bdf8', stroke: '#0f172a', strokeWidth: 2 }}>
                  <LabelList dataKey="count" position="top" fill="#bae6fd" fontSize={10} offset={8} formatter={(v: any) => v > 0 ? v : ''} />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          ) : emptyChart(270)}
        </div>

        {/* Loss by Category horizontal bar */}
        <div className="chart-box col-5">
          <div className="chart-box-header">
            <div>
              <h4>Loss by Category (Hours)</h4>
              <p className="chart-sub">Downtime grouped by root-cause department</p>
            </div>
          </div>
          {stats.catData.length > 0 ? (
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={stats.catData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
                <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false} width={140} />
                <RechartsTooltip contentStyle={ttStyle} itemStyle={ttItemStyle} labelStyle={ttLabelStyle} formatter={(v: any) => [`${v}h`, 'Downtime']} />
                <Bar isAnimationActive={false} dataKey="hours" radius={[0,6,6,0]} maxBarSize={26}>
                  {stats.catData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  <LabelList dataKey="hours" position="right" fill="#cbd5e1" fontSize={11} fontWeight="bold"
                    formatter={(v: any) => v > 0 ? `${v}h` : ''} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : emptyChart(270)}
        </div>

        {/* ── CHARTS ROW 3 — Hourly rhythm + RCA ── */}

        {/* 24-hour production rhythm */}
        <div className="chart-box col-7">
          <div className="chart-box-header">
            <div>
              <h4>24-Hour Production Rhythm <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 400 }}>(06:00 → 06:00)</span></h4>
              <p className="chart-sub">Stoppage wave across Shift A (6–14h), Shift B (14–22h), Shift C (22–6h)</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={stats.hourlyData}>
              <defs>
                <linearGradient id="gradBd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.breakdown} stopOpacity={0.6} />
                  <stop offset="95%" stopColor={C.breakdown} stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="gradMin" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.minor} stopOpacity={0.6} />
                  <stop offset="95%" stopColor={C.minor} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={{ stroke: '#334155' }} tickLine={false} interval={1} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false}
                label={{ value: 'Incidents', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 10, offset: 10 }} />
              <RechartsTooltip contentStyle={ttStyle} itemStyle={ttItemStyle} labelStyle={ttLabelStyle} />
              <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }} />
              <Area isAnimationActive={false} type="monotone" dataKey="bd"  name="Breakdown"      stroke={C.breakdown} strokeWidth={2} fill="url(#gradBd)" />
              <Area isAnimationActive={false} type="monotone" dataKey="min" name="Minor Stoppage"  stroke={C.minor}     strokeWidth={2} fill="url(#gradMin)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* RCA compliance donut */}
        <div className="chart-box col-5">
          <div className="chart-box-header">
            <div>
              <h4>RCA Compliance</h4>
              <p className="chart-sub">Root-cause investigation rate per event</p>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie isAnimationActive={false} data={stats.rcaData}
                  cx="50%" cy="50%" innerRadius={50} outerRadius={72}
                  paddingAngle={4} dataKey="value" labelLine={false}
                >
                  {stats.rcaData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <RechartsTooltip contentStyle={ttStyle} itemStyle={ttItemStyle} labelStyle={ttLabelStyle} />
                <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '44%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: stats.rcaPct >= 80 ? '#22c55e' : '#ef4444' }}>{stats.rcaPct}%</div>
              <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px', marginTop: 2 }}>RCA done</div>
            </div>
          </div>
          <div className="rca-target-banner">
            <span className="rca-target-label">Target: <strong>≥ 80% RCA Complete</strong></span>
            <span className={`rca-target-badge ${stats.rcaPct >= 80 ? 'achieved' : 'missed'}`}>
              {stats.rcaPct >= 80 ? '✓ Target Achieved' : '⚠ Action Needed'}
            </span>
          </div>
        </div>

      </div>{/* end charts layout */}

      {/* ══════════════════════════════════════════════════════
          TOP 5 CRITICAL INCIDENTS TABLE
      ══════════════════════════════════════════════════════ */}
      <div className="tpm-table-section" style={{ marginTop: '24px' }}>
        <div className="tpm-section-header">
          <div>
            <h4>Top 5 Longest Stoppages</h4>
            <p className="chart-sub">Critical production-loss incidents ranked by duration</p>
          </div>
        </div>
        <div className="table-responsive">
          <table className="tpm-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date &amp; Time</th>
                <th>Category</th>
                <th>Duration</th>
                <th>Reason</th>
                <th>RCA Status</th>
              </tr>
            </thead>
            <tbody>
              {stats.top5.map(item => (
                <tr key={item.rank}>
                  <td><span style={{ fontWeight: 700, color: item.rank === 1 ? '#ef4444' : '#f8fafc' }}>#{item.rank}</span></td>
                  <td style={{ fontSize: '0.85rem' }}>{item.date}</td>
                  <td>
                    <span className={`tpm-badge ${item.isBd ? 'danger' : 'warning'}`}>
                      {item.category}
                    </span>
                  </td>
                  <td className="dur" style={{ color: '#f8fafc', fontWeight: 700 }}>{item.duration}</td>
                  <td className="reason-col" style={{ fontSize: '0.85rem' }}>{item.reason}</td>
                  <td>
                    <span className={`tpm-badge-outline ${item.rca ? 'success' : 'pending'}`}>
                      {item.rca ? '✓ RCA Done' : '⏳ Pending'}
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
          <summary>How these numbers are calculated</summary>
          <div className="details-content">
            <p><strong>Production Day:</strong> Runs 06:00 AM → 06:00 AM next morning. Events before 06:00 belong to the previous day.</p>
            <p><strong>3 Shifts:</strong> Shift A = 06:00–14:00 · Shift B = 14:00–22:00 · Shift C = 22:00–06:00.</p>
            <p><strong>Total Downtime:</strong> Sum of all event durations in the selected filter period.</p>
            <p><strong>Avg Breakdown (MTTR):</strong> Average duration of "Breakdown" type events only.</p>
            <p><strong>RCA Complete:</strong> % of events where the Reason/Action field is filled (not blank or "Pending reason").</p>
          </div>
        </details>
      </div>

    </div>
  );
};
