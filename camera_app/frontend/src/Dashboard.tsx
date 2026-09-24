import React, { useState, useEffect, useMemo } from 'react';
import { RecordingRecord } from './api';
import { 
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, ResponsiveContainer, Line, ComposedChart, Legend, LabelList, ReferenceLine,
  AreaChart, Area
} from 'recharts';

interface DashboardProps {
  records: RecordingRecord[];
}

const FullscreenIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

const COLORS = {
  breakdown: '#ef4444', 
  minor: '#f59e0b',
  selfCapture: '#3b82f6',
  trend: '#0ea5e9',
  documented: '#22c55e',
  pending: '#f59e0b',
  noRca: '#64748b',
  pie1: '#ef4444',
  pie2: '#f59e0b',
  pie3: '#3b82f6',
  donut1: '#8b5cf6',
  donut2: '#10b981',
  donut3: '#f43f5e'
};

// Color map for reason_category field values from the Event Report form
const CATEGORY_COLORS_MAP: Record<string, string> = {
  'Machine Breakdown':        '#ef4444',
  'Die Breakdown':            '#f97316',
  'Robot Breakdown':          '#a855f7',
  'Process Loss':             '#3b82f6',
  'Management Loss':          '#64748b',
  'Planned Downtime':         '#22c55e',
  'HPDC Machine Accessories': '#ec4899',
};

function getCategoryColor(name: string): string {
  return CATEGORY_COLORS_MAP[name] || '#6366f1';
}

function formatDuration(seconds: number, format: 'short' | 'long' = 'long') {
  if (isNaN(seconds) || seconds < 0) return format === 'long' ? '0 sec' : '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (format === 'short') {
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
  
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 && h === 0) parts.push(`${s}s`);
  return parts.length > 0 ? parts.join(' ') : '0s';
}

function formatDurationDigital(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function eventDuration(record: RecordingRecord) {
  return record.event_duration_seconds || record.duration_seconds || 0;
}

function hasRca(record: RecordingRecord) {
  const reason = (record.reason || record.manual_transcript || '').trim();
  if (!reason || reason.toLowerCase() === 'pending reason') return false;
  return true;
}

export const Dashboard: React.FC<DashboardProps> = ({ records }) => {
  const [fullscreenChart, setFullscreenChart] = useState<string | null>(null);
  const [reasonSort, setReasonSort] = useState<'duration' | 'frequency'>('duration');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreenChart(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const stats = useMemo(() => {
    let breakdownSec = 0;
    let minorSec = 0;
    let selfCaptureSec = 0;
    let breakdownCount = 0;
    let minorCount = 0;
    let selfCaptureCount = 0;
    
    let documentedCount = 0;
    let withVideoCount = 0;
    
    let firstEventTime = Infinity;
    let lastEventTime = 0;

    const hourlyCounts = Array.from({length: 24}, () => ({ breakdown: 0, minor: 0, other: 0 }));
    const dailyMap: Record<string, number> = {};
    const shiftMap: Record<string, number> = { A: 0, B: 0, C: 0 };
    
    // For RCA Status
    let loggedNoRca = 0;
    let pending = 0;
    
    const validRecords = records.filter(r => r.started_at);

    validRecords.forEach(r => {
      const duration = eventDuration(r);
      const isBreakdown = r.event_type === 'breakdown';
      const isMinor = r.event_type === 'minor_stoppage';
      
      if (isBreakdown) {
        breakdownCount++;
        breakdownSec += duration;
      } else if (isMinor) {
        minorCount++;
        minorSec += duration;
      } else {
        selfCaptureCount++;
        selfCaptureSec += duration;
        // Operator Triggered (previously 'Self Capture')
      }

      if (hasRca(r)) {
        documentedCount++;
      } else {
        const reason = (r.reason || '').trim().toLowerCase();
        if (reason === 'pending reason' || reason === '') pending++;
        else loggedNoRca++;
      }
      
      if (r.file_path) withVideoCount++;

      const d = new Date(r.started_at as string);
      if (isNaN(d.getTime())) return;

      const timeMs = d.getTime();
      if (timeMs < firstEventTime) firstEventTime = timeMs;
      if (timeMs > lastEventTime) lastEventTime = timeMs;

      const hour = d.getHours();
      const min = d.getMinutes();
      const timeNum = hour + min / 60;
      
      // 3 Shifts of 8 hours each:
      // Shift A: 06:00 to 14:00 (6:00am – 2:00pm)
      // Shift B: 14:00 to 22:00 (2:00pm – 10:00pm)
      // Shift C: 22:00 to 06:00 (10:00pm – 6:00am)
      let shift = 'C';
      if (timeNum >= 6 && timeNum < 14) shift = 'A';
      else if (timeNum >= 14 && timeNum < 22) shift = 'B';
      else shift = 'C';
      
      shiftMap[shift] = (shiftMap[shift] || 0) + duration;

      if (isBreakdown) hourlyCounts[hour].breakdown++;
      else if (isMinor) hourlyCounts[hour].minor++;
      else hourlyCounts[hour].other++;
      
      // Production Day: Runs from 06:00 AM to 06:00 AM next day
      // Any stoppage before 06:00 AM belongs to the previous calendar day's production day
      const prodDate = new Date(d);
      if (prodDate.getHours() < 6) {
        prodDate.setDate(prodDate.getDate() - 1);
      }
      const dateStr = prodDate.toLocaleDateString('en-GB'); // DD/MM/YYYY
      if (!dailyMap[dateStr]) dailyMap[dateStr] = 0;
      dailyMap[dateStr] += duration;
    });

    const totalSec = breakdownSec + minorSec + selfCaptureSec;
    const totalEvents = validRecords.length;
    const pendingRcaCount = pending + loggedNoRca;
    
    // KPIs
    const avgBreakdownSec = breakdownCount > 0 ? (breakdownSec / breakdownCount) : 0;
    const maxStoppageSec = validRecords.reduce((max, r) => Math.max(max, eventDuration(r)), 0);
    const rcaPercent = totalEvents > 0 ? Math.round((documentedCount / totalEvents) * 100) : 0;

    // Event type donut data
    const categoryFreqData = [
      { name: 'Breakdown', value: breakdownCount, fill: COLORS.breakdown },
      { name: 'Minor Stoppage', value: minorCount, fill: COLORS.minor },
      { name: 'Operator Triggered', value: selfCaptureCount, fill: COLORS.selfCapture },
    ].filter(d => d.value > 0);

    // Daily data + cumulative line
    const dailyDataRaw = Object.keys(dailyMap).map(date => ({
      date: date.substring(0, 5),
      hours: parseFloat((dailyMap[date] / 3600).toFixed(2)),
      fullDate: date,
    })).sort((a, b) => a.fullDate.localeCompare(b.fullDate));

    let cumAcc = 0;
    const dailyData = dailyDataRaw.map(d => {
      cumAcc += d.hours;
      return { ...d, cumulative: parseFloat(cumAcc.toFixed(2)) };
    });

    const avgDailyHours = dailyData.length > 0
      ? parseFloat((dailyData.reduce((s, d) => s + d.hours, 0) / dailyData.length).toFixed(2))
      : 0;

    // Hourly — all 24h of the production day in shift sequence (Shift A: 6-14, Shift B: 14-22, Shift C: 22-6)
    const factoryHourSequence = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
    const factoryHourlyData = factoryHourSequence.map(hour => ({
      name: `${hour.toString().padStart(2, '0')}:00`,
      hour,
      shift: hour >= 6 && hour < 14 ? 'Shift A' : hour >= 14 && hour < 22 ? 'Shift B' : 'Shift C',
      breakdown: hourlyCounts[hour].breakdown,
      minor: hourlyCounts[hour].minor,
      other: hourlyCounts[hour].other,
      total: hourlyCounts[hour].breakdown + hourlyCounts[hour].minor + hourlyCounts[hour].other
    }));

    // Standard 0-23 array for summary table
    const hourlyData = hourlyCounts.map((data, hour) => ({
      name: `${hour}:00`,
      breakdown: data.breakdown,
      minor: data.minor,
      other: data.other,
      total: data.breakdown + data.minor + data.other
    }));

    // RCA donut data
    const rcaData = [
      { name: 'RCA Done',       value: documentedCount, fill: COLORS.documented },
      { name: 'Logged-No RCA',  value: loggedNoRca,     fill: COLORS.noRca },
      { name: 'Pending',        value: pending,          fill: '#fb923c' },
    ].filter(d => d.value > 0);

    // Top Stoppage Reasons - By Duration & Frequency
    const reasonDurMap: Record<string, number> = {};
    const reasonCntMap: Record<string, number> = {};
    validRecords.forEach(r => {
      let reason = (r.reason || '').trim();
      if (!reason || reason.toLowerCase() === 'pending reason') {
        reason = 'Pending Reason';
      } else if (reason.includes(' - ')) {
        const parts = reason.split(' - ');
        reason = parts.length > 2 ? `${parts[1]} - ${parts[2]}` : parts[parts.length - 1];
      }
      reasonDurMap[reason] = (reasonDurMap[reason] || 0) + eventDuration(r);
      reasonCntMap[reason] = (reasonCntMap[reason] || 0) + 1;
    });
    
    // Top reasons ranked by Duration
    const sortedDurReasons = Object.keys(reasonDurMap).map(k => ({
      name: k.length > 18 ? k.substring(0, 18) + '…' : k,
      fullName: k,
      duration: reasonDurMap[k],
      count: reasonCntMap[k] || 0
    })).sort((a, b) => b.duration - a.duration);

    const topReasonsByDuration = sortedDurReasons.slice(0, 8).map(item => ({
      name: item.name,
      fullName: item.fullName,
      durationHours: parseFloat((item.duration / 3600).toFixed(2)),
      count: item.count,
      avgMinutes: item.count > 0 ? Math.round(item.duration / item.count / 60) : 0,
      percent: totalSec > 0 ? parseFloat(((item.duration / totalSec) * 100).toFixed(1)) : 0,
    }));

    // Top reasons ranked by Frequency (Count)
    const sortedCntReasons = Object.keys(reasonCntMap).map(k => ({
      name: k.length > 18 ? k.substring(0, 18) + '…' : k,
      fullName: k,
      count: reasonCntMap[k],
      duration: reasonDurMap[k] || 0
    })).sort((a, b) => b.count - a.count);

    const topReasonsByCount = sortedCntReasons.slice(0, 8).map(item => ({
      name: item.name,
      fullName: item.fullName,
      durationHours: parseFloat((item.duration / 3600).toFixed(2)),
      count: item.count,
      avgMinutes: item.count > 0 ? Math.round(item.duration / item.count / 60) : 0,
      percent: totalSec > 0 ? parseFloat(((item.duration / totalSec) * 100).toFixed(1)) : 0,
    }));

    // 3 Shifts (8 hours each): Shift A (6am-2pm), Shift B (2pm-10pm), Shift C (10pm-6am)
    const shiftData = [
      { name: 'Shift A (6am–2pm)',  value: parseFloat(((shiftMap['A'] || 0) / 3600).toFixed(2)), fill: COLORS.donut1 },
      { name: 'Shift B (2pm–10pm)', value: parseFloat(((shiftMap['B'] || 0) / 3600).toFixed(2)), fill: COLORS.donut2 },
      { name: 'Shift C (10pm–6am)', value: parseFloat(((shiftMap['C'] || 0) / 3600).toFixed(2)), fill: COLORS.donut3 }
    ].filter(d => d.value > 0);

    // Reason Category data — grouped by reason_category or L1 department from reason
    const reasonCategoryMap: Record<string, { sec: number; count: number }> = {};
    validRecords.forEach(r => {
      let cat = (r.reason_category || '').trim();
      if (!cat || cat === 'breakdown' || cat === 'minor_stoppage' || cat === 'self_capture') {
        const reason = (r.reason || '').trim();
        if (reason.includes(' - ')) {
          cat = reason.split(' - ')[0].trim();
        } else if (r.event_type === 'breakdown') {
          cat = 'Machine Breakdown';
        } else if (r.event_type === 'minor_stoppage') {
          cat = 'Minor Stoppage';
        } else {
          cat = 'Other Stoppage';
        }
      }
      if (!reasonCategoryMap[cat]) {
        reasonCategoryMap[cat] = { sec: 0, count: 0 };
      }
      reasonCategoryMap[cat].sec += eventDuration(r);
      reasonCategoryMap[cat].count += 1;
    });

    const reasonCategoryData = Object.entries(reasonCategoryMap)
      .map(([name, info]) => ({
        name: name.length > 22 ? name.substring(0, 22) + '…' : name,
        fullName: name,
        value: parseFloat((info.sec / 3600).toFixed(2)),
        count: info.count,
        fill: getCategoryColor(name)
      }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);
    
    // Automated Insights
    const top3DurationHours = topReasonsByDuration.slice(0, 3).reduce((acc, r) => acc + r.durationHours, 0);
    const top3Percent = totalSec > 0 ? ((top3DurationHours * 3600 / totalSec) * 100).toFixed(0) : '0';
    
    let worstDay = { fullDate: '-', hours: 0 };
    dailyData.forEach(d => { if (d.hours > worstDay.hours) worstDay = d; });
    
    const maxTotal = Math.max(...hourlyData.map(d => d.total));
    const peakHourIndex = hourlyData.findIndex(d => d.total === maxTotal);
    const peakHour = maxTotal > 0 ? `${peakHourIndex}:00-${peakHourIndex+1}:00` : '-';
    
    const largestStoppage = validRecords.length > 0 ? [...validRecords].sort((a, b) => eventDuration(b) - eventDuration(a))[0] : null;
    const largestPercent = largestStoppage && totalSec > 0 ? (eventDuration(largestStoppage) / totalSec * 100).toFixed(0) : '0';

    const shiftSummary = {
      A: {
        hours: parseFloat(((shiftMap['A'] || 0) / 3600).toFixed(2)),
        count: validRecords.filter(r => {
          const d = new Date(r.started_at as string);
          if (isNaN(d.getTime())) return false;
          const t = d.getHours() + d.getMinutes() / 60;
          return t >= 6 && t < 14;
        }).length
      },
      B: {
        hours: parseFloat(((shiftMap['B'] || 0) / 3600).toFixed(2)),
        count: validRecords.filter(r => {
          const d = new Date(r.started_at as string);
          if (isNaN(d.getTime())) return false;
          const t = d.getHours() + d.getMinutes() / 60;
          return t >= 14 && t < 22;
        }).length
      },
      C: {
        hours: parseFloat(((shiftMap['C'] || 0) / 3600).toFixed(2)),
        count: validRecords.filter(r => {
          const d = new Date(r.started_at as string);
          if (isNaN(d.getTime())) return false;
          const t = d.getHours() + d.getMinutes() / 60;
          return t >= 22 || t < 6;
        }).length
      },
    };

    return {
      totalEvents, totalSec, breakdownSec, minorSec, selfCaptureSec,
      avgBreakdownSec, maxStoppageSec, rcaPercent, pendingRcaCount,
      categoryFreqData, dailyData, avgDailyHours, factoryHourlyData, hourlyData,
      rcaData, topReasonsByDuration, topReasonsByCount, shiftData, shiftSummary, reasonCategoryData,
      topRecords: [...validRecords].sort((a, b) => eventDuration(b) - eventDuration(a)).slice(0, 10),
      allRecords: validRecords,
      insights: {
        breakdownPercent: totalSec > 0 ? (breakdownSec / totalSec * 100).toFixed(0) : '0',
        breakdownCount,
        largestStoppage,
        largestPercent,
        top3Percent,
        top3DurationHours,
        missingRcaPercent: totalEvents > 0 ? (((pending + loggedNoRca) / totalEvents) * 100).toFixed(0) : '0',
        missingRcaCount: pending + loggedNoRca,
        peakHour,
        worstDay
      }
    };
  }, [records]);

  if (stats.totalEvents === 0) {
    return <div className="p-8 text-center text-gray-400">No records found for the selected period.</div>;
  }

  const renderCustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: '#0f172a', border: '1px solid #334155', padding: '10px 14px', borderRadius: '8px', minWidth: '130px' }}>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{payload[0].name}</p>
          <p style={{ color: payload[0].fill || '#fff', margin: '4px 0 0', fontSize: '15px', fontWeight: '700' }}>
            {typeof payload[0].value === 'number' ? `${payload[0].value}h` : payload[0].value}
          </p>
        </div>
      );
    }
    return null;
  };

  const emptyChartPlaceholder = (msg: string, height = 240) => (
    <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '0.88rem', textAlign: 'center', padding: '20px', gap: '8px' }}>
      <span style={{ fontSize: '2rem' }}>📋</span>
      <span style={{ whiteSpace: 'pre-line' }}>{msg}</span>
    </div>
  );

  const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, name }: any) => {
    const radius = innerRadius + (outerRadius - innerRadius) + 20;
    const x = cx + radius * Math.cos(-midAngle * (Math.PI / 180));
    const y = cy + radius * Math.sin(-midAngle * (Math.PI / 180));
    if (percent < 0.05) return null; // Don't show label for very small slices
    return (
      <text x={x} y={y} fill="#cbd5e1" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const renderFullscreenModal = () => {
    if (!fullscreenChart) return null;

    let title = '';
    let subtitle = '';
    let chartElement = null;
    let drilldownElement = null;

    switch (fullscreenChart) {
      case 'event_type': {
        title = 'Event Type Distribution — Detailed View';
        subtitle = 'Complete breakdown of stoppage classifications, count proportion, and total lost hours';
        chartElement = (
          <div style={{ position: 'relative', width: '100%', height: 420 }}>
            <ResponsiveContainer width="100%" height={420}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={stats.categoryFreqData}
                  cx="50%"
                  cy="50%"
                  innerRadius={110}
                  outerRadius={165}
                  paddingAngle={5}
                  dataKey="value"
                  labelLine={true}
                  label={({ name, percent, value }: any) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                >
                  {stats.categoryFreqData.map((entry, index) => (
                    <Cell key={`modal-evt-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} />
                <Legend verticalAlign="bottom" height={42} wrapperStyle={{ fontSize: '13px', color: '#cbd5e1' }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '46%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: '38px', fontWeight: '800', color: '#f1f5f9', lineHeight: 1 }}>{stats.totalEvents}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '2px', marginTop: '6px' }}>Total Events</div>
            </div>
          </div>
        );
        drilldownElement = (
          <div className="chart-modal-drilldown">
            <h4>Data Drilldown: Event Classification Breakdown</h4>
            <table className="tpm-table">
              <thead>
                <tr>
                  <th>Event Category</th>
                  <th>Incident Count</th>
                  <th>% of Events</th>
                  <th>Total Downtime</th>
                  <th>% of Total Loss</th>
                  <th>Avg Stoppage Duration</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="tpm-badge danger">Breakdown</span></td>
                  <td style={{ fontWeight: 'bold' }}>{stats.insights.breakdownCount}</td>
                  <td>{stats.totalEvents > 0 ? ((stats.insights.breakdownCount / stats.totalEvents) * 100).toFixed(1) : 0}%</td>
                  <td style={{ color: COLORS.breakdown, fontWeight: 'bold' }}>{formatDuration(stats.breakdownSec, 'short')}</td>
                  <td>{stats.totalSec > 0 ? ((stats.breakdownSec / stats.totalSec) * 100).toFixed(1) : 0}%</td>
                  <td>{formatDurationDigital(stats.avgBreakdownSec)}</td>
                </tr>
                <tr>
                  <td><span className="tpm-badge warning">Minor Stoppage</span></td>
                  <td style={{ fontWeight: 'bold' }}>{stats.categoryFreqData.find(d => d.name === 'Minor Stoppage')?.value || 0}</td>
                  <td>{stats.totalEvents > 0 ? (((stats.categoryFreqData.find(d => d.name === 'Minor Stoppage')?.value || 0) / stats.totalEvents) * 100).toFixed(1) : 0}%</td>
                  <td style={{ color: COLORS.minor, fontWeight: 'bold' }}>{formatDuration(stats.minorSec, 'short')}</td>
                  <td>{stats.totalSec > 0 ? ((stats.minorSec / stats.totalSec) * 100).toFixed(1) : 0}%</td>
                  <td>{formatDurationDigital(stats.minorSec / Math.max(1, stats.categoryFreqData.find(d => d.name === 'Minor Stoppage')?.value || 1))}</td>
                </tr>
                <tr>
                  <td><span className="tpm-badge info">Operator Triggered</span></td>
                  <td style={{ fontWeight: 'bold' }}>{stats.categoryFreqData.find(d => d.name === 'Operator Triggered')?.value || 0}</td>
                  <td>{stats.totalEvents > 0 ? (((stats.categoryFreqData.find(d => d.name === 'Operator Triggered')?.value || 0) / stats.totalEvents) * 100).toFixed(1) : 0}%</td>
                  <td style={{ color: COLORS.selfCapture, fontWeight: 'bold' }}>{formatDuration(stats.selfCaptureSec, 'short')}</td>
                  <td>{stats.totalSec > 0 ? ((stats.selfCaptureSec / stats.totalSec) * 100).toFixed(1) : 0}%</td>
                  <td>{formatDurationDigital(stats.selfCaptureSec / Math.max(1, stats.categoryFreqData.find(d => d.name === 'Operator Triggered')?.value || 1))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
        break;
      }
      case 'shift': {
        title = 'Downtime by Shift — Detailed View';
        subtitle = 'Factory shift production loss analysis across Shift A (Morning), Shift B (Evening), and Shift C (Night)';
        chartElement = (
          <div style={{ position: 'relative', width: '100%', height: 420 }}>
            <ResponsiveContainer width="100%" height={420}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={stats.shiftData}
                  cx="50%"
                  cy="50%"
                  innerRadius={110}
                  outerRadius={165}
                  paddingAngle={5}
                  dataKey="value"
                  labelLine={true}
                  label={({ name, percent, value }: any) => `${name.split(' ')[0]}: ${value}h (${(percent * 100).toFixed(0)}%)`}
                >
                  {stats.shiftData.map((entry, index) => (
                    <Cell key={`modal-shift-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                  formatter={(value: any, name: any) => [`${value} hours`, name]}
                />
                <Legend verticalAlign="bottom" height={42} wrapperStyle={{ fontSize: '13px', color: '#cbd5e1' }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '46%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: '38px', fontWeight: '800', color: '#f1f5f9', lineHeight: 1 }}>{parseFloat((stats.totalSec / 3600).toFixed(1))}h</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '2px', marginTop: '6px' }}>Total Downtime</div>
            </div>
          </div>
        );
        drilldownElement = (
          <div className="chart-modal-drilldown">
            <h4>Data Drilldown: Shift Production Impact</h4>
            <table className="tpm-table">
              <thead>
                <tr>
                  <th>Shift Designation</th>
                  <th>Working Hours Window</th>
                  <th>Total Downtime Logged</th>
                  <th>% Contribution to Total Loss</th>
                  <th>Shift Severity Level</th>
                </tr>
              </thead>
              <tbody>
                {stats.shiftData.map((s, idx) => {
                  const pct = stats.totalSec > 0 ? ((s.value * 3600 / stats.totalSec) * 100).toFixed(1) : '0';
                  return (
                    <tr key={idx}>
                      <td style={{ fontWeight: 'bold', color: s.fill }}>{s.name.split(' (')[0]}</td>
                      <td>{s.name.includes('(') ? s.name.split('(')[1].replace(')', '') : '-'}</td>
                      <td style={{ fontWeight: 'bold' }}>{s.value} hours</td>
                      <td>{pct}%</td>
                      <td>
                        <span className={`tpm-badge ${parseFloat(pct) > 40 ? 'danger' : parseFloat(pct) > 20 ? 'warning' : 'success'}`}>
                          {parseFloat(pct) > 40 ? 'High Loss Zone' : parseFloat(pct) > 20 ? 'Moderate Loss' : 'Normal'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        break;
      }
      case 'daily_trend': {
        title = 'Daily Downtime Trend & Cumulative Trajectory';
        subtitle = 'Day-by-day downtime hours compared against the daily average baseline with cumulative production loss curve';
        chartElement = (
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={stats.dailyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={false} label={{ value: 'Daily Hours Lost', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12, offset: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#38bdf8', fontSize: 12 }} axisLine={false} tickLine={false} label={{ value: 'Cumulative Total (Hours)', angle: 90, position: 'insideRight', fill: '#38bdf8', fontSize: 12, offset: 5 }} />
              <RechartsTooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} />
              <Legend verticalAlign="top" height={40} wrapperStyle={{ fontSize: '13px', color: '#cbd5e1' }} />
              <ReferenceLine yAxisId="left" y={stats.avgDailyHours} stroke="#38bdf8" strokeDasharray="6 3" strokeWidth={1.8}
                label={{ value: `Avg ${stats.avgDailyHours}h / day`, fill: '#38bdf8', fontSize: 11, position: 'insideTopRight' }}
              />
              <Bar yAxisId="left" isAnimationActive={false} dataKey="hours" name="Daily Downtime (h)" radius={[6, 6, 0, 0]} maxBarSize={60}>
                {stats.dailyData.map((entry, index) => (
                  <Cell
                    key={`modal-day-${index}`}
                    fill={entry.fullDate === stats.insights.worstDay.fullDate ? '#ef4444' : '#fbbf24'}
                    opacity={entry.fullDate === stats.insights.worstDay.fullDate ? 1 : 0.85}
                  />
                ))}
                <LabelList dataKey="hours" position="top" fill="#cbd5e1" fontSize={11} formatter={(v: any) => v > 0 ? `${v}h` : ''} />
              </Bar>
              <Line yAxisId="right" isAnimationActive={false} type="monotone" dataKey="cumulative" name="Cumulative Loss (h)" stroke="#38bdf8" strokeWidth={3} dot={{ r: 4, fill: '#38bdf8' }} />
            </ComposedChart>
          </ResponsiveContainer>
        );
        drilldownElement = (
          <div className="chart-modal-drilldown">
            <h4>Data Drilldown: Daily Breakdown Log</h4>
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              <table className="tpm-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Downtime (Hours)</th>
                    <th>Cumulative (Hours)</th>
                    <th>Variance vs Daily Avg ({stats.avgDailyHours}h)</th>
                    <th>Day Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.dailyData.map((d, idx) => {
                    const diff = parseFloat((d.hours - stats.avgDailyHours).toFixed(2));
                    const isWorst = d.fullDate === stats.insights.worstDay.fullDate;
                    return (
                      <tr key={idx} style={isWorst ? { background: 'rgba(239,68,68,0.08)' } : {}}>
                        <td style={{ fontWeight: isWorst ? 'bold' : 'normal', color: isWorst ? '#ef4444' : '#f8fafc' }}>
                          {d.fullDate} {isWorst ? '★ (Peak Loss)' : ''}
                        </td>
                        <td style={{ fontWeight: 'bold' }}>{d.hours}h</td>
                        <td style={{ color: '#38bdf8' }}>{d.cumulative}h</td>
                        <td style={{ color: diff > 0 ? '#ef4444' : '#22c55e' }}>
                          {diff > 0 ? `+${diff}h above avg` : `${diff}h below avg`}
                        </td>
                        <td>
                          <span className={`tpm-badge ${isWorst ? 'danger' : diff > 0 ? 'warning' : 'success'}`}>
                            {isWorst ? 'Peak Stoppage Day' : diff > 0 ? 'Above Normal' : 'Optimal'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
        break;
      }
      case 'hourly': {
        title = '24-Hour Production Rhythm (06:00am – 06:00am Next Day)';
        subtitle = 'Stoppage intensity curve across Shift A (06:00–14:00), Shift B (14:00–22:00), and Shift C (22:00–06:00)';
        chartElement = (
          <ResponsiveContainer width="100%" height={420}>
            <AreaChart data={stats.factoryHourlyData}>
              <defs>
                <linearGradient id="modalHourBreakdownGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.breakdown} stopOpacity={0.65} />
                  <stop offset="95%" stopColor={COLORS.breakdown} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="modalHourMinorGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.minor} stopOpacity={0.65} />
                  <stop offset="95%" stopColor={COLORS.minor} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false} label={{ value: 'Incident Count', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12, offset: 10 }} />
              <RechartsTooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} />
              <Legend verticalAlign="top" height={40} wrapperStyle={{ fontSize: '13px', color: '#cbd5e1' }} />
              <Area type="monotone" dataKey="breakdown" name="Breakdown" stroke={COLORS.breakdown} strokeWidth={2.5} fill="url(#modalHourBreakdownGrad)" />
              <Area type="monotone" dataKey="minor" name="Minor Stoppage" stroke={COLORS.minor} strokeWidth={2.5} fill="url(#modalHourMinorGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        );
        drilldownElement = (
          <div className="chart-modal-drilldown">
            <h4>Data Drilldown: Hourly Stoppage Frequency Table (Shift Chronological Order)</h4>
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              <table className="tpm-table">
                <thead>
                  <tr>
                    <th>Time Window</th>
                    <th>Shift</th>
                    <th>Total Incidents</th>
                    <th>Breakdowns</th>
                    <th>Minor Stoppages</th>
                    <th>Operator Triggered</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.factoryHourlyData.map((h, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 'bold' }}>{h.name} – {((h.hour + 1) % 24).toString().padStart(2, '0')}:00</td>
                      <td><span className="tpm-badge info">{h.shift}</span></td>
                      <td style={{ fontWeight: 'bold' }}>{h.total}</td>
                      <td>
                        {h.breakdown > 0 ? <span className="tpm-badge danger">{h.breakdown}</span> : '-'}
                      </td>
                      <td>
                        {h.minor > 0 ? <span className="tpm-badge warning">{h.minor}</span> : '-'}
                      </td>
                      <td>{h.other > 0 ? h.other : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
        break;
      }
      case 'rca': {
        title = 'Root Cause Analysis (RCA) Completion & Quality Status';
        subtitle = 'Compliance audit of documented root-cause investigations vs unverified machine stoppages';
        chartElement = (
          <div style={{ position: 'relative', width: '100%', height: 420 }}>
            <ResponsiveContainer width="100%" height={420}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={stats.rcaData}
                  cx="50%"
                  cy="50%"
                  innerRadius={110}
                  outerRadius={165}
                  paddingAngle={5}
                  dataKey="value"
                  labelLine={true}
                  label={({ name, percent, value }: any) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                >
                  {stats.rcaData.map((entry, index) => (
                    <Cell key={`modal-rca-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} />
                <Legend verticalAlign="bottom" height={42} wrapperStyle={{ fontSize: '13px', color: '#cbd5e1' }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '46%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: '42px', fontWeight: '800', color: stats.rcaPercent >= 80 ? '#22c55e' : '#ef4444', lineHeight: 1 }}>{stats.rcaPercent}%</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '2px', marginTop: '6px' }}>Compliance Rate</div>
            </div>
          </div>
        );
        drilldownElement = (
          <div className="chart-modal-drilldown">
            <h4>Data Drilldown: Root Cause Compliance Audit</h4>
            <table className="tpm-table">
              <thead>
                <tr>
                  <th>Documentation Status</th>
                  <th>Event Count</th>
                  <th>% of Stoppages</th>
                  <th>Action Required</th>
                </tr>
              </thead>
              <tbody>
                {stats.rcaData.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <span className={`tpm-badge-outline ${item.name === 'RCA Done' ? 'success' : item.name === 'Pending' ? 'danger' : 'warning'}`}>
                        {item.name}
                      </span>
                    </td>
                    <td style={{ fontWeight: 'bold' }}>{item.value}</td>
                    <td>{stats.totalEvents > 0 ? ((item.value / stats.totalEvents) * 100).toFixed(1) : 0}%</td>
                    <td>
                      {item.name === 'RCA Done'
                        ? '✓ Verified by engineering'
                        : '⚠ Review Event Report tab and enter 5-Why root cause'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        break;
      }
      case 'categories': {
        title = 'Top Breakdown Categories & Departments (Hours)';
        subtitle = 'Categorization by department / failure source (Machine, Die, Robot, Process, Electrical)';
        chartElement = stats.reasonCategoryData.length > 0 ? (
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={stats.reasonCategoryData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={false} />
              <YAxis dataKey="fullName" type="category" tick={{ fill: '#cbd5e1', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={false} width={180} />
              <RechartsTooltip
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                formatter={(value: any) => [`${value} hours`, 'Downtime']}
              />
              <Bar isAnimationActive={false} dataKey="value" radius={[0, 8, 8, 0]} maxBarSize={36}>
                {stats.reasonCategoryData.map((entry, index) => (
                  <Cell key={`modal-cat-${index}`} fill={entry.fill} />
                ))}
                <LabelList dataKey="value" position="right" fill="#cbd5e1" fontSize={13} fontWeight="bold" formatter={(v: any) => v > 0 ? `${v}h` : ''} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : emptyChartPlaceholder('Fill reason categories in Event Report to view category breakdown.', 420);
        drilldownElement = (
          <div className="chart-modal-drilldown">
            <h4>Data Drilldown: Departmental Downtime Contributions</h4>
            <table className="tpm-table">
              <thead>
                <tr>
                  <th>Category / Department</th>
                  <th>Total Downtime Logged</th>
                  <th>Incident Count</th>
                  <th>% of Total Plant Downtime</th>
                  <th>Average Duration</th>
                </tr>
              </thead>
              <tbody>
                {stats.reasonCategoryData.map((cat, idx) => {
                  const pct = stats.totalSec > 0 ? ((cat.value * 3600 / stats.totalSec) * 100).toFixed(1) : '0';
                  const avg = cat.count > 0 ? formatDuration(cat.value * 3600 / cat.count, 'short') : '-';
                  return (
                    <tr key={idx}>
                      <td style={{ fontWeight: 'bold', color: cat.fill }}>{cat.fullName}</td>
                      <td style={{ fontWeight: 'bold' }}>{cat.value} hours</td>
                      <td>{cat.count}</td>
                      <td>{pct}%</td>
                      <td>{avg}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        break;
      }
      case 'reasons': {
        const isDuration = reasonSort === 'duration';
        title = `Top Stoppage Causes — ${isDuration ? 'Sorted by Downtime (Hours)' : 'Sorted by Frequency (Trips)'}`;
        subtitle = isDuration
          ? 'COMBO Analysis: Downtime Loss (Red Columns) vs Incident Frequency (Cyan Line with Markers)'
          : 'COMBO Analysis: Incident Frequency (Cyan Line with Markers) vs Downtime Loss (Red Columns)';
        const activeData = isDuration ? stats.topReasonsByDuration : stats.topReasonsByCount;
        chartElement = (
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={activeData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis yAxisId="left" tick={{ fill: '#ef4444', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false} label={{ value: 'Downtime (Hours)', angle: -90, position: 'insideLeft', fill: '#ef4444', fontSize: 12, offset: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#38bdf8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false} label={{ value: 'Incident Count', angle: 90, position: 'insideRight', fill: '#38bdf8', fontSize: 12, offset: 5 }} />
              <RechartsTooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} />
              <Legend verticalAlign="top" height={40} wrapperStyle={{ fontSize: '13px', color: '#cbd5e1' }} />
              <Bar isAnimationActive={false} yAxisId="left" dataKey="durationHours" fill="#ef4444" name="Downtime (Hours)" radius={[6, 6, 0, 0]} maxBarSize={48}>
                <LabelList dataKey="durationHours" position="top" fill="#fca5a5" fontSize={11} formatter={(v: any) => v > 0 ? `${v}h` : ''} />
              </Bar>
              <Line isAnimationActive={false} yAxisId="right" type="monotone" dataKey="count" stroke="#38bdf8" strokeWidth={3} name="Incident Count" dot={{ r: 5, fill: '#38bdf8', stroke: '#0f172a', strokeWidth: 2 }} activeDot={{ r: 7 }}>
                <LabelList dataKey="count" position="top" fill="#bae6fd" fontSize={11} offset={8} formatter={(v: any) => v > 0 ? v : ''} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        );
        drilldownElement = (
          <div className="chart-modal-drilldown">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ margin: 0 }}>Data Drilldown: Stoppage Root Causes Ranking</h4>
              <div className="modal-toggle-group">
                <button
                  type="button"
                  className={`modal-toggle-btn ${reasonSort === 'duration' ? 'active' : ''}`}
                  onClick={() => setReasonSort('duration')}
                >
                  By Downtime (Hours)
                </button>
                <button
                  type="button"
                  className={`modal-toggle-btn ${reasonSort === 'frequency' ? 'active' : ''}`}
                  onClick={() => setReasonSort('frequency')}
                >
                  By Frequency (Count)
                </button>
              </div>
            </div>
            <table className="tpm-table">
              <thead>
                <tr>
                  <th>Rank #</th>
                  <th>Stoppage Failure Reason</th>
                  <th>Total Downtime</th>
                  <th>Incident Count</th>
                  <th>Avg Duration (MTTR)</th>
                  <th>% of Total Loss</th>
                  <th>Severity Level</th>
                </tr>
              </thead>
              <tbody>
                {activeData.map((item, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 'bold' }}>#{idx + 1}</td>
                    <td style={{ fontWeight: '600', color: '#f8fafc' }}>{item.fullName}</td>
                    <td style={{ fontWeight: 'bold', color: '#ef4444' }}>{item.durationHours}h</td>
                    <td style={{ fontWeight: 'bold', color: '#38bdf8' }}>{item.count}</td>
                    <td>{item.avgMinutes > 60 ? `${(item.avgMinutes / 60).toFixed(1)}h` : `${item.avgMinutes}m`}</td>
                    <td style={{ fontWeight: 'bold' }}>{item.percent}%</td>
                    <td>
                      <span className={`tpm-badge ${item.percent > 20 ? 'danger' : item.count > 3 ? 'warning' : 'info'}`}>
                        {item.percent > 20 ? 'Critical Loss' : item.count > 3 ? 'Recurring Trip' : 'Normal'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        break;
      }
      default:
        return null;
    }

    return (
      <div className="chart-modal-backdrop" onClick={() => setFullscreenChart(null)}>
        <div className="chart-modal-container" onClick={(e) => e.stopPropagation()}>
          <div className="chart-modal-header">
            <div>
              <h3>{title}</h3>
              <p>{subtitle}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {fullscreenChart === 'reasons' && (
                <div className="modal-toggle-group">
                  <button
                    type="button"
                    className={`modal-toggle-btn ${reasonSort === 'duration' ? 'active' : ''}`}
                    onClick={() => setReasonSort('duration')}
                  >
                    Downtime
                  </button>
                  <button
                    type="button"
                    className={`modal-toggle-btn ${reasonSort === 'frequency' ? 'active' : ''}`}
                    onClick={() => setReasonSort('frequency')}
                  >
                    Frequency
                  </button>
                </div>
              )}
              <button
                type="button"
                className="chart-modal-close-btn"
                title="Close (or press Esc)"
                onClick={() => setFullscreenChart(null)}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="chart-modal-body">
            {chartElement}
            {drilldownElement}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="tpm-dashboard">
      <div className="tpm-header">
        <h1>Machine Stoppage Analytics</h1>
        <p>Live analysis of stoppage logs. Automated metrics active. All {stats.totalEvents} rows parsed successfully.</p>
      </div>

      {/* Hero Header */}
      <div className="tpm-hero-header">
        <div className="hero-left">
          <div className="hero-label">Total downtime logged</div>
          <div className="hero-value">{formatDuration(stats.totalSec, 'short')}</div>
          <div className="hero-sub">{stats.totalEvents} stoppage events logged</div>
        </div>
        <div className="hero-right">
          <div className="split-metric">
            <span className="split-val" style={{color: COLORS.breakdown}}>{formatDurationDigital(stats.breakdownSec)}</span>
            <span className="split-label">Breakdown ({stats.categoryFreqData.find(d=>d.name==='Breakdown')?.value||0})</span>
          </div>
          <div className="split-metric">
            <span className="split-val" style={{color: COLORS.minor}}>{formatDurationDigital(stats.minorSec)}</span>
            <span className="split-label">Minor Stoppage ({stats.categoryFreqData.find(d=>d.name==='Minor Stoppage')?.value||0})</span>
          </div>
          <div className="split-metric">
            <span className="split-val" style={{color: COLORS.selfCapture}}>{formatDurationDigital(stats.selfCaptureSec)}</span>
            <span className="split-label">Operator Triggered ({stats.categoryFreqData.find(d=>d.name==='Operator Triggered')?.value||0})</span>
          </div>
        </div>
      </div>

      {/* KPI Cards (Colorful) */}
      <div className="tpm-kpi-grid">
        <div className="kpi-card color-blue">
          <div className="kpi-val">{stats.totalEvents}</div>
          <div className="kpi-label">Total Stoppage Events</div>
          <div style={{fontSize:'0.75rem',color:'#64748b',marginTop:'3px'}}>{stats.insights.breakdownCount} BD &nbsp;·&nbsp; {stats.totalEvents - stats.insights.breakdownCount} Minor/Other</div>
        </div>
        <div className="kpi-card color-red">
          <div className="kpi-val">{formatDuration(stats.totalSec, 'short')}</div>
          <div className="kpi-label">Total Downtime</div>
          <div style={{fontSize:'0.75rem',color:'#64748b',marginTop:'3px'}}>Avg {stats.avgDailyHours}h / day</div>
        </div>
        <div className="kpi-card color-orange">
          <div className="kpi-val">{formatDurationDigital(stats.avgBreakdownSec)}</div>
          <div className="kpi-label">Avg Breakdown Duration</div>
          <div style={{fontSize:'0.75rem',color:'#64748b',marginTop:'3px'}}>Per breakdown event</div>
        </div>
        <div className="kpi-card color-purple">
          <div className="kpi-val">{formatDuration(stats.maxStoppageSec, 'short')}</div>
          <div className="kpi-label">Longest Stoppage</div>
          <div style={{fontSize:'0.75rem',color:'#64748b',marginTop:'3px'}}>Single worst event</div>
        </div>
        <div className="kpi-card color-green">
          <div className="kpi-val">{stats.rcaPercent}%</div>
          <div className="kpi-label">RCA Complete</div>
          <div style={{fontSize:'0.75rem',color:'#64748b',marginTop:'3px'}}>{stats.totalEvents - stats.pendingRcaCount} of {stats.totalEvents} filled</div>
        </div>
        <div className="kpi-card" style={{borderColor: stats.pendingRcaCount > 10 ? '#ef4444' : '#f59e0b', background: 'rgba(239,68,68,0.07)'}}>
          <div className="kpi-val" style={{color: stats.pendingRcaCount > 10 ? '#ef4444' : '#f59e0b'}}>{stats.pendingRcaCount}</div>
          <div className="kpi-label" style={{color:'#94a3b8'}}>Pending RCA</div>
          <div style={{fontSize:'0.75rem',color: stats.pendingRcaCount > 0 ? '#ef4444' : '#22c55e',marginTop:'3px',fontWeight:'600'}}>
            {stats.pendingRcaCount > 0 ? '⚠ Action needed' : '✓ All resolved'}
          </div>
        </div>
      </div>

      {/* Automated Insights */}
      <div className="tpm-insights-panel">
        <h3>Automated Insights</h3>
        <ul>
          <li>
            <span style={{color: COLORS.breakdown, fontWeight: 'bold'}}>Breakdown</span> accounts for&nbsp;
            <strong>{stats.insights.breakdownPercent}%</strong> of total downtime ({formatDurationDigital(stats.breakdownSec)})
            across {stats.insights.breakdownCount} events.
          </li>
          {stats.insights.largestStoppage && (
            <li>
              Largest single stoppage was on&nbsp;
              <strong>{stats.insights.largestStoppage.started_at ? new Date(stats.insights.largestStoppage.started_at).toLocaleDateString('en-GB') : ''}</strong>,
              contributing <strong>{stats.insights.largestPercent}%</strong> of all logged downtime.
            </li>
          )}
          <li>
            Top 3 stoppage causes contribute to <strong>{stats.insights.top3Percent}%</strong> of all logged downtime
            ({stats.insights.top3DurationHours.toFixed(1)}h) — focusing on these root causes will give maximum payback.
          </li>
          <li>
            <strong>{stats.insights.missingRcaPercent}%</strong> of events ({stats.insights.missingRcaCount} of {stats.totalEvents}) have
            <strong style={{color: COLORS.pending}}> no completed root-cause action</strong>.
          </li>
          <li>
            Peak stoppage hour: <strong>{stats.insights.peakHour}</strong> — check shift-change or load timing.
          </li>
          {stats.insights.worstDay.hours > 0 && (
            <li>
              <strong style={{color: '#ef4444'}}>{stats.insights.worstDay.fullDate}</strong> had the most downtime
              at <strong>{stats.insights.worstDay.hours}h</strong> —&nbsp;
              <span style={{color: '#ef4444', fontWeight: '700'}}>highlighted in red</span> on the daily chart below.
            </li>
          )}
        </ul>
      </div>

      {/* Charts Grid - 3 Logical Tiers */}
      <div className="tpm-charts-layout">

        {/* ============================================================== */}
        {/* TIER 1: OPERATIONAL RHYTHM & SHIFT TIMELINE                    */}
        {/* ============================================================== */}

        {/* CHART 1 (col-7) — 24-Hour Production Rhythm (06:00 to 06:00) */}
        <div className="chart-box col-7">
          <div className="chart-box-header">
            <div>
              <h4>24-Hour Production Rhythm <span style={{fontSize:'0.8rem',color:'#64748b',fontWeight:400}}>(06:00am – 06:00am)</span></h4>
              <p className="chart-sub">Downtime wave across Shift A (6-14), Shift B (14-22), and Shift C (22-6)</p>
            </div>
            <button
              type="button"
              className="chart-fullscreen-btn"
              title="Expand to Fullscreen"
              onClick={() => setFullscreenChart('hourly')}
            >
              <FullscreenIcon /> Expand
            </button>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={stats.factoryHourlyData}>
              <defs>
                <linearGradient id="mainHourBreakdownGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.breakdown} stopOpacity={0.65} />
                  <stop offset="95%" stopColor={COLORS.breakdown} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="mainHourMinorGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.minor} stopOpacity={0.65} />
                  <stop offset="95%" stopColor={COLORS.minor} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
              <XAxis dataKey="name" tick={{fill: '#94a3b8', fontSize: 10}} axisLine={{stroke: '#334155'}} tickLine={false} />
              <YAxis tick={{fill: '#94a3b8', fontSize: 11}} axisLine={{stroke: '#334155'}} tickLine={false} label={{ value: 'Incident Count', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11, offset: 10 }} />
              <RechartsTooltip cursor={{fill: 'rgba(255,255,255,0.03)'}} contentStyle={{background: '#0f172a', border: '1px solid #334155', borderRadius: '8px'}} />
              <Legend verticalAlign="top" height={32} wrapperStyle={{fontSize: '11px', color: '#cbd5e1'}} />
              <Area isAnimationActive={false} type="monotone" dataKey="breakdown" name="Breakdown" stroke={COLORS.breakdown} strokeWidth={2.2} fill="url(#mainHourBreakdownGrad)" />
              <Area isAnimationActive={false} type="monotone" dataKey="minor" name="Minor Stoppage" stroke={COLORS.minor} strokeWidth={2.2} fill="url(#mainHourMinorGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* CHART 2 (col-5) — Downtime by Shift (8-Hour Windows) */}
        <div className="chart-box col-5">
          <div className="chart-box-header">
            <div>
              <h4>Downtime by Shift (Hours)</h4>
              <p className="chart-sub">3 Shifts of 8 hours (A: 6-14, B: 14-22, C: 22-6)</p>
            </div>
            <button
              type="button"
              className="chart-fullscreen-btn"
              title="Expand to Fullscreen"
              onClick={() => setFullscreenChart('shift')}
            >
              <FullscreenIcon /> Expand
            </button>
          </div>
          <div style={{position:'relative'}}>
            {stats.shiftData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie isAnimationActive={false}
                  data={stats.shiftData}
                  cx="50%" cy="50%"
                  innerRadius={50} outerRadius={72}
                  labelLine={false}
                  dataKey="value" paddingAngle={4}
                >
                  {stats.shiftData.map((entry, index) => (
                    <Cell key={`shift-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                  formatter={(value: any, name: any) => [`${value}h`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            ) : emptyChartPlaceholder('No shift data available.', 180)}
            <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',textAlign:'center',pointerEvents:'none'}}>
              <div style={{fontSize:'19px',fontWeight:'800',color:'#f1f5f9',lineHeight:1}}>{parseFloat((stats.totalSec/3600).toFixed(1))}h</div>
              <div style={{fontSize:'9px',color:'#64748b',textTransform:'uppercase',letterSpacing:'1.2px',marginTop:'2px'}}>total loss</div>
            </div>
          </div>
          <div className="shift-pills-row">
            <div className="shift-pill-card">
              <div className="shift-pill-name" style={{ color: COLORS.donut1 }}>Shift A</div>
              <div className="shift-pill-val">{stats.shiftSummary.A.hours}h</div>
              <div className="shift-pill-time">06:00–14:00 ({stats.shiftSummary.A.count} evts)</div>
            </div>
            <div className="shift-pill-card">
              <div className="shift-pill-name" style={{ color: COLORS.donut2 }}>Shift B</div>
              <div className="shift-pill-val">{stats.shiftSummary.B.hours}h</div>
              <div className="shift-pill-time">14:00–22:00 ({stats.shiftSummary.B.count} evts)</div>
            </div>
            <div className="shift-pill-card">
              <div className="shift-pill-name" style={{ color: COLORS.donut3 }}>Shift C</div>
              <div className="shift-pill-val">{stats.shiftSummary.C.hours}h</div>
              <div className="shift-pill-time">22:00–06:00 ({stats.shiftSummary.C.count} evts)</div>
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* TIER 2: ROOT CAUSE ANALYSIS & MAINTENANCE ENGINEERING          */}
        {/* ============================================================== */}

        {/* CHART 3 (col-7) — Top Stoppage Causes (COMBO Chart: Clustered Column + Line on Secondary Axis) */}
        <div className="chart-box col-7">
          <div className="chart-box-header">
            <div>
              <h4>Top Stoppage Causes — Loss & Frequency Analysis</h4>
              <p className="chart-sub">
                🟥 Column = Downtime (Hours) &nbsp;·&nbsp; 🔵 Line with Dots = Incident Frequency
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="modal-toggle-group">
                <button
                  type="button"
                  className={`modal-toggle-btn ${reasonSort === 'duration' ? 'active' : ''}`}
                  onClick={() => setReasonSort('duration')}
                >
                  Sort Downtime
                </button>
                <button
                  type="button"
                  className={`modal-toggle-btn ${reasonSort === 'frequency' ? 'active' : ''}`}
                  onClick={() => setReasonSort('frequency')}
                >
                  Sort Frequency
                </button>
              </div>
              <button
                type="button"
                className="chart-fullscreen-btn"
                title="Expand to Fullscreen"
                onClick={() => setFullscreenChart('reasons')}
              >
                <FullscreenIcon /> Expand
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={290}>
            <ComposedChart data={reasonSort === 'duration' ? stats.topReasonsByDuration : stats.topReasonsByCount}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
              <XAxis dataKey="name" tick={{fill: '#94a3b8', fontSize: 10}} axisLine={{stroke: '#334155'}} tickLine={false} interval={0} angle={-15} textAnchor="end" height={52} />
              <YAxis yAxisId="left" tick={{fill: '#ef4444', fontSize: 11}} axisLine={{stroke: '#334155'}} tickLine={false} label={{ value: 'Downtime (Hours)', angle: -90, position: 'insideLeft', fill: '#ef4444', fontSize: 11, offset: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{fill: '#38bdf8', fontSize: 11}} axisLine={{stroke: '#334155'}} tickLine={false} label={{ value: 'Incident Count', angle: 90, position: 'insideRight', fill: '#38bdf8', fontSize: 11, offset: 5 }} />
              <RechartsTooltip cursor={{fill: 'rgba(255,255,255,0.03)'}} contentStyle={{background: '#0f172a', border: '1px solid #334155', borderRadius: '8px'}} />
              <Legend verticalAlign="top" height={32} wrapperStyle={{fontSize: '11px', color: '#cbd5e1'}} />
              <Bar isAnimationActive={false} yAxisId="left" dataKey="durationHours" fill="#ef4444" name="Downtime (Hours)" radius={[5,5,0,0]} maxBarSize={38}>
                <LabelList dataKey="durationHours" position="top" fill="#fca5a5" fontSize={11} formatter={(v: any) => v > 0 ? `${v}h` : ''} />
              </Bar>
              <Line isAnimationActive={false} yAxisId="right" type="monotone" dataKey="count" stroke="#38bdf8" strokeWidth={2.5} name="Incident Count" dot={{ r: 4, fill: '#38bdf8', stroke: '#0f172a', strokeWidth: 2 }} activeDot={{ r: 6 }}>
                <LabelList dataKey="count" position="top" fill="#bae6fd" fontSize={11} offset={8} formatter={(v: any) => v > 0 ? v : ''} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* CHART 4 (col-5) — Loss by Department / Reason Category (Horizontal Bar) */}
        <div className="chart-box col-5">
          <div className="chart-box-header">
            <div>
              <h4>Loss by Category / Dept (Hours)</h4>
              <p className="chart-sub">Downtime grouped by maintenance source</p>
            </div>
            <button
              type="button"
              className="chart-fullscreen-btn"
              title="Expand to Fullscreen"
              onClick={() => setFullscreenChart('categories')}
            >
              <FullscreenIcon /> Expand
            </button>
          </div>
          {stats.reasonCategoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={290}>
              <BarChart data={stats.reasonCategoryData.slice(0, 6)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
                <XAxis type="number" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={{stroke: '#334155'}} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={{stroke: '#334155'}} tickLine={false} width={135} />
                <RechartsTooltip
                  cursor={{fill: 'rgba(255,255,255,0.03)'}}
                  contentStyle={{background: '#0f172a', border: '1px solid #334155', borderRadius: '8px'}}
                  formatter={(value: any) => [`${value}h`, 'Downtime']}
                />
                <Bar isAnimationActive={false} dataKey="value" radius={[0,6,6,0]} maxBarSize={28}>
                  {stats.reasonCategoryData.slice(0, 6).map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                  <LabelList dataKey="value" position="right" fill="#cbd5e1" fontSize={11} fontWeight="bold"
                    formatter={(v: unknown): string | number => (v as number) > 0 ? `${v}h` : ''}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : emptyChartPlaceholder('Fill reason categories in Event Report\nto see this chart.', 290)}
        </div>

        {/* ============================================================== */}
        {/* TIER 3: TREND & GOVERNANCE (CONTINUOUS IMPROVEMENT)            */}
        {/* ============================================================== */}

        {/* CHART 5 (col-7) — Multi-Day Downtime & Cumulative Loss (COMBO Chart) */}
        <div className="chart-box col-7">
          <div className="chart-box-header">
            <div>
              <h4>
                Daily Downtime Trend & Cumulative Loss
                {stats.insights.worstDay.hours > 0 && stats.dailyData.length > 1 && (
                  <span style={{ marginLeft: '10px', fontSize: '0.75rem', color: '#ef4444', fontWeight: '700', background: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: '20px', border: '1px solid rgba(239,68,68,0.25)' }}>
                    ● Worst: {stats.insights.worstDay.fullDate} ({stats.insights.worstDay.hours}h)
                  </span>
                )}
              </h4>
              <p className="chart-sub">
                06:00am–06:00am &nbsp;·&nbsp; 🟥 Bar = Daily Downtime &nbsp;·&nbsp; 🔵 Line = Cumulative Total &nbsp;·&nbsp; ⬜ Dashed = Avg ({stats.avgDailyHours}h)
              </p>
            </div>
            <button
              type="button"
              className="chart-fullscreen-btn"
              title="Expand to Fullscreen"
              onClick={() => setFullscreenChart('daily_trend')}
            >
              <FullscreenIcon /> Expand
            </button>
          </div>

          {stats.dailyData.length === 1 && (
            <div className="single-day-notice">
              <span>📅</span>
              <span><strong>Single Production Day:</strong> Viewing logs for {stats.dailyData[0].fullDate} ({stats.dailyData[0].hours}h downtime). Select a wider date filter to view multi-day trend.</span>
            </div>
          )}

          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={stats.dailyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
              <XAxis dataKey="date" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={{stroke: '#334155'}} tickLine={false} />
              <YAxis yAxisId="left" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={{stroke: '#334155'}} tickLine={false} label={{ value: 'Hours/Day', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 10, offset: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{fill: '#475569', fontSize: 10}} axisLine={false} tickLine={false} label={{ value: 'Cumulative (h)', angle: 90, position: 'insideRight', fill: '#475569', fontSize: 10, offset: 5 }} />
              <RechartsTooltip cursor={{fill: 'rgba(255,255,255,0.03)'}} contentStyle={{background: '#0f172a', border: '1px solid #334155', borderRadius: '8px'}} />
              <Legend verticalAlign="top" height={28} wrapperStyle={{fontSize: '11px', color: '#94a3b8'}} />
              <ReferenceLine yAxisId="left" y={stats.avgDailyHours} stroke="#38bdf8" strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: `Avg ${stats.avgDailyHours}h`, fill: '#38bdf8', fontSize: 10, position: 'insideTopRight' }}
              />
              <Bar yAxisId="left" isAnimationActive={false} dataKey="hours" name="Daily Downtime (h)" radius={[5,5,0,0]} maxBarSize={44}>
                {stats.dailyData.map((entry, index) => (
                  <Cell key={`day-${index}`}
                    fill={entry.fullDate === stats.insights.worstDay.fullDate && stats.dailyData.length > 1 ? '#ef4444' : '#fbbf24'}
                    opacity={entry.fullDate === stats.insights.worstDay.fullDate ? 1 : 0.8}
                  />
                ))}
                <LabelList dataKey="hours" position="top" fill="#cbd5e1" fontSize={11} formatter={(v: any) => v > 0 ? `${v}h` : ''} />
              </Bar>
              <Line yAxisId="right" isAnimationActive={false} type="monotone" dataKey="cumulative" name="Cumulative (h)" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 4, fill: '#38bdf8' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* CHART 6 (col-5) — RCA Compliance & Quality Audit */}
        <div className="chart-box col-5">
          <div className="chart-box-header">
            <div>
              <h4>RCA Compliance & Quality Audit</h4>
              <p className="chart-sub">Root-cause investigation rate per stoppage</p>
            </div>
            <button
              type="button"
              className="chart-fullscreen-btn"
              title="Expand to Fullscreen"
              onClick={() => setFullscreenChart('rca')}
            >
              <FullscreenIcon /> Expand
            </button>
          </div>
          <div style={{position:'relative'}}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie isAnimationActive={false}
                  data={stats.rcaData}
                  cx="50%" cy="50%"
                  innerRadius={50} outerRadius={72}
                  paddingAngle={4} dataKey="value"
                  labelLine={false}
                >
                  {stats.rcaData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                </Pie>
                <RechartsTooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} />
                <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{position:'absolute',top:'44%',left:'50%',transform:'translate(-50%,-50%)',textAlign:'center',pointerEvents:'none'}}>
              <div style={{fontSize:'22px',fontWeight:'800',color: stats.rcaPercent >= 80 ? '#22c55e' : '#ef4444',lineHeight:1}}>{stats.rcaPercent}%</div>
              <div style={{fontSize:'9px',color:'#64748b',textTransform:'uppercase',letterSpacing:'1.2px',marginTop:'2px'}}>RCA done</div>
            </div>
          </div>
          <div className="rca-target-banner">
            <span className="rca-target-label">
              Quality Target: <strong>&ge; 80% RCA Complete</strong>
            </span>
            <span className={`rca-target-badge ${stats.rcaPercent >= 80 ? 'achieved' : 'missed'}`}>
              {stats.rcaPercent >= 80 ? '✓ Target Achieved' : '⚠ Action Needed'}
            </span>
          </div>
        </div>

      </div>

      {/* Top 10 Table */}
      <div className="tpm-table-section">
        <h4>Top 10 Longest Stoppages</h4>
        <div className="table-responsive">
          <table className="tpm-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Start Date & Time</th>
                <th>Category</th>
                <th>Duration</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stats.topRecords.map((r, i) => {
                const d = r.started_at ? new Date(r.started_at).toLocaleString('en-GB') : '-';
                const isBreakdown = r.event_type === 'breakdown';
                const documented = hasRca(r);
                return (
                  <tr key={r.file_path || i}>
                    <td>{i+1}</td>
                    <td>{d}</td>
                    <td>
                      <span className={`tpm-badge ${isBreakdown ? 'danger' : 'warning'}`}>
                        {isBreakdown ? 'Breakdown' : 'Minor Stoppage'}
                      </span>
                    </td>
                    <td className="dur">{formatDurationDigital(eventDuration(r))}</td>
                    <td className="reason-col">{r.reason || 'Pending reason'}</td>
                    <td>
                      <span className={`tpm-badge-outline ${documented ? 'success' : 'pending'}`}>
                        {documented ? '✓ RCA Done' : '⏳ Pending RCA'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hourly Breakdown Table */}
      <div className="tpm-table-section mt-8">
        <h4>Hourly Stoppage Summary (Production Day Sequence: 06:00 to 06:00)</h4>
        <div className="table-responsive">
          <table className="tpm-table">
            <thead>
              <tr>
                <th>Hour Window</th>
                <th>Shift</th>
                <th>Total Events</th>
                <th>Breakdowns</th>
                <th>Minor Stoppages</th>
                <th>Operator Triggered</th>
              </tr>
            </thead>
            <tbody>
              {stats.factoryHourlyData.filter(d => d.total > 0).map((d) => (
                <tr key={d.name}>
                  <td style={{ fontWeight: 'bold' }}>{d.name} – {((d.hour + 1) % 24).toString().padStart(2, '0')}:00</td>
                  <td><span className="tpm-badge info">{d.shift}</span></td>
                  <td style={{ fontWeight: 'bold' }}>{d.total}</td>
                  <td>
                    {d.breakdown > 0 ? (
                      <span className="tpm-badge danger" style={{ background: COLORS.breakdown, color: '#fff' }}>{d.breakdown}</span>
                    ) : '-'}
                  </td>
                  <td>
                    {d.minor > 0 ? (
                      <span className="tpm-badge warning" style={{ background: COLORS.minor, color: '#fff' }}>{d.minor}</span>
                    ) : '-'}
                  </td>
                  <td>{d.other > 0 ? d.other : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Methodology Section */}
      <div className="tpm-methodology">
        <details>
          <summary>How these numbers are calculated</summary>
          <div className="details-content">
            <p><strong>Production Day (1 Day):</strong> Runs from 06:00 AM to 06:00 AM the following morning. Any events between 00:00 and 05:59 belong to the previous calendar day's production day.</p>
            <p><strong>3 Shifts (8 Hours Each):</strong> Shift A = 06:00 to 14:00 (Morning) &nbsp;|&nbsp; Shift B = 14:00 to 22:00 (Evening) &nbsp;|&nbsp; Shift C = 22:00 to 06:00 (Night).</p>
            <p><strong>Total downtime:</strong> Sum of all event durations in the selected date/category/shift filter.</p>
            <p><strong>Avg Breakdown Duration:</strong> Average duration of "Breakdown" type events only.</p>
            <p><strong>Longest Stoppage:</strong> The single event with the highest duration in the filtered set.</p>
            <p><strong>Root-cause documented:</strong> % of events where Reason/Action field is filled (not blank or "Pending reason").</p>
            <p><strong>Top Stoppage Reasons:</strong> Ranks machine failure causes by downtime hours and frequency (occurrence count) side-by-side without confusing cumulative curves.</p>
            <p><strong>Worst Day:</strong> The production date with the highest total downtime — highlighted in red on the daily bar chart.</p>
          </div>
        </details>
      </div>

      {/* Fullscreen Chart Modal */}
      {renderFullscreenModal()}

    </div>
  );
};
