import React, { useMemo } from 'react';
import { RecordingRecord } from './api';
import { 
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, ResponsiveContainer, LineChart, Line, ComposedChart, Legend 
} from 'recharts';

interface DashboardProps {
  records: RecordingRecord[];
}

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

    const hourlyCounts = new Array(24).fill(0);
    const dailyMap: Record<string, number> = {};
    
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
      const timeMs = d.getTime();
      if (timeMs < firstEventTime) firstEventTime = timeMs;
      if (timeMs > lastEventTime) lastEventTime = timeMs;

      const hour = d.getHours();
      hourlyCounts[hour]++;
      
      const dateStr = d.toLocaleDateString('en-GB'); // DD/MM/YYYY
      if (!dailyMap[dateStr]) dailyMap[dateStr] = 0;
      dailyMap[dateStr] += duration;
    });

    const totalSec = breakdownSec + minorSec + selfCaptureSec;
    const totalEvents = validRecords.length;
    
    // KPIs
    const mttrSec = breakdownCount > 0 ? (breakdownSec / breakdownCount) : 0;
    const mtbfSec = breakdownCount > 1 ? ((lastEventTime - firstEventTime) / 1000) / breakdownCount : 0;
    const rcaPercent = totalEvents > 0 ? Math.round((documentedCount / totalEvents) * 100) : 0;
    const videoPercent = totalEvents > 0 ? Math.round((withVideoCount / totalEvents) * 100) : 0;

    // Charts Data
    const categoryFreqData = [
      { name: 'Breakdown', value: breakdownCount, fill: COLORS.breakdown },
      { name: 'Minor Stoppage', value: minorCount, fill: COLORS.minor },
      { name: 'Self Capture', value: selfCaptureCount, fill: COLORS.selfCapture },
    ].filter(d => d.value > 0);

    const categoryTimeData = [
      { name: 'Breakdown', value: parseFloat((breakdownSec / 3600).toFixed(2)), fill: COLORS.breakdown },
      { name: 'Minor Stoppage', value: parseFloat((minorSec / 3600).toFixed(2)), fill: COLORS.minor },
      { name: 'Self Capture', value: parseFloat((selfCaptureSec / 3600).toFixed(2)), fill: COLORS.selfCapture },
    ].filter(d => d.value > 0);

    const dailyData = Object.keys(dailyMap).map(date => ({
      date: date.substring(0, 5), // DD/MM
      hours: parseFloat((dailyMap[date] / 3600).toFixed(2)),
      fullDate: date,
      rawSec: dailyMap[date]
    })).sort((a, b) => a.fullDate.localeCompare(b.fullDate));

    const hourlyData = hourlyCounts.map((count, hour) => ({
      name: `${hour}`,
      count
    }));

    const rcaData = [
      { name: 'Documented', value: documentedCount, fill: COLORS.documented },
      { name: 'Logged (No RCA)', value: loggedNoRca, fill: COLORS.noRca },
      { name: 'Pending', value: pending, fill: COLORS.pending },
    ];

    // Pareto Analysis
    const sortedRecords = [...validRecords].sort((a, b) => eventDuration(b) - eventDuration(a));
    const paretoData = [];
    let cumulativeSec = 0;
    
    for (let i = 0; i < Math.min(15, sortedRecords.length); i++) {
      const r = sortedRecords[i];
      const dur = eventDuration(r);
      cumulativeSec += dur;
      const cumPercent = totalSec > 0 ? (cumulativeSec / totalSec) * 100 : 0;
      paretoData.push({
        id: `#${i+1}`,
        durationMin: parseFloat((dur / 60).toFixed(1)),
        cumulative: parseFloat(cumPercent.toFixed(1))
      });
    }
    
    // Automated Insights
    let pareto80Count = 0;
    for (const p of paretoData) {
      pareto80Count++;
      if (p.cumulative >= 80) break;
    }
    
    let worstDay = { fullDate: '-', hours: 0 };
    dailyData.forEach(d => { if (d.hours > worstDay.hours) worstDay = d; });
    
    const peakHourIndex = hourlyCounts.indexOf(Math.max(...hourlyCounts));
    const peakHour = Math.max(...hourlyCounts) > 0 ? `${peakHourIndex}:00-${peakHourIndex+1}:00` : '-';
    
    const largestStoppage = sortedRecords.length > 0 ? sortedRecords[0] : null;
    const largestPercent = largestStoppage && totalSec > 0 ? (eventDuration(largestStoppage) / totalSec * 100).toFixed(0) : '0';

    return {
      totalEvents, totalSec, breakdownSec, minorSec, selfCaptureSec,
      mttrSec, mtbfSec, rcaPercent, videoPercent,
      categoryFreqData, categoryTimeData, dailyData, hourlyData, rcaData, paretoData,
      topRecords: sortedRecords.slice(0, 10),
      allRecords: sortedRecords,
      insights: {
        breakdownPercent: totalSec > 0 ? (breakdownSec / totalSec * 100).toFixed(0) : '0',
        breakdownCount,
        largestStoppage,
        largestPercent,
        pareto80Count,
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
        <div className="custom-tooltip">
          <p className="label">{`${payload[0].name} : ${payload[0].value}`}</p>
        </div>
      );
    }
    return null;
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
            <span className="split-label">Self Capture ({stats.categoryFreqData.find(d=>d.name==='Self Capture')?.value||0})</span>
          </div>
        </div>
      </div>

      {/* KPI Cards (Colorful) */}
      <div className="tpm-kpi-grid">
        <div className="kpi-card color-blue">
          <div className="kpi-val">{stats.totalEvents}</div>
          <div className="kpi-label">Total Stoppage Events</div>
        </div>
        <div className="kpi-card color-red">
          <div className="kpi-val">{formatDuration(stats.totalSec, 'short')}</div>
          <div className="kpi-label">Total Downtime</div>
        </div>
        <div className="kpi-card color-orange">
          <div className="kpi-val">{formatDurationDigital(stats.mttrSec)}</div>
          <div className="kpi-label">MTTR (Avg. Repair Time)</div>
        </div>
        <div className="kpi-card color-purple">
          <div className="kpi-val">{stats.mtbfSec > 0 ? (stats.mtbfSec / 3600).toFixed(1) + 'h' : '-'}</div>
          <div className="kpi-label">MTBF (Avg. Time Btw Breakdowns)</div>
        </div>
        <div className="kpi-card color-green">
          <div className="kpi-val">{stats.rcaPercent}%</div>
          <div className="kpi-label">Root-Cause Documented</div>
        </div>
        <div className="kpi-card color-teal">
          <div className="kpi-val">{stats.videoPercent}%</div>
          <div className="kpi-label">Events with Video Captured</div>
        </div>
      </div>

      {/* Automated Insights */}
      <div className="tpm-insights-panel">
        <h3>Automated Insights</h3>
        <ul>
          <li>
            <span style={{color: COLORS.breakdown, fontWeight: 'bold'}}>Breakdown</span> accounts for 
            <strong> {stats.insights.breakdownPercent}%</strong> of total downtime ({formatDurationDigital(stats.breakdownSec)}) 
            across {stats.insights.breakdownCount} events.
          </li>
          {stats.insights.largestStoppage && (
            <li>
              The single largest stoppage is <strong>{stats.insights.largestStoppage.started_at ? new Date(stats.insights.largestStoppage.started_at).toLocaleDateString('en-GB') : ''}</strong>, 
              equal to <strong>{stats.insights.largestPercent}%</strong> of all logged downtime on its own.
            </li>
          )}
          <li>
            Just <strong>{stats.insights.pareto80Count} of {stats.totalEvents}</strong> events ({(stats.insights.pareto80Count/stats.totalEvents*100).toFixed(0)}%) 
            account for 80% of total downtime — fixing these first gives the fastest payback.
          </li>
          <li>
            <strong>{stats.insights.missingRcaPercent}%</strong> of events ({stats.insights.missingRcaCount} of {stats.totalEvents}) have 
            <strong style={{color: COLORS.pending}}> no completed root-cause action</strong>.
          </li>
          <li>
            Stoppages occur most around <strong>{stats.insights.peakHour}</strong> — worth checking operator shift-change or peak-load timing.
          </li>
          {stats.insights.worstDay.hours > 0 && (
            <li>
              <strong>{stats.insights.worstDay.fullDate}</strong> was the worst day logged, with {stats.insights.worstDay.hours}h of downtime.
            </li>
          )}
        </ul>
      </div>

      {/* Charts Grid */}
      <div className="tpm-charts-layout">
        
        <div className="chart-box">
          <h4>Events by Category (Pie Chart)</h4>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={stats.categoryFreqData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {stats.categoryFreqData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <RechartsTooltip content={renderCustomTooltip} />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-box">
          <h4>Downtime by Category (Donut Chart)</h4>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={stats.categoryTimeData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                fill="#82ca9d"
                dataKey="value"
                paddingAngle={5}
              >
                {stats.categoryTimeData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <RechartsTooltip content={renderCustomTooltip} />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-box full-width">
          <h4>Downtime by date (Hours)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.dailyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
              <XAxis dataKey="date" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} />
              <YAxis tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} />
              <RechartsTooltip cursor={{fill: '#1e293b'}} contentStyle={{background: '#0f172a', border: 'none'}} />
              <Bar dataKey="hours" fill="#fbbf24" radius={[4,4,0,0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-box">
          <h4>Stoppages by hour of day</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.hourlyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
              <XAxis dataKey="name" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} />
              <YAxis tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} />
              <RechartsTooltip cursor={{fill: '#1e293b'}} contentStyle={{background: '#0f172a', border: 'none'}} />
              <Bar dataKey="count" fill="#38bdf8" radius={[2,2,0,0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-box">
          <h4>Root-cause documentation status</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.rcaData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
              <XAxis type="number" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} width={100} />
              <RechartsTooltip cursor={{fill: '#1e293b'}} contentStyle={{background: '#0f172a', border: 'none'}} />
              <Bar dataKey="value" radius={[0,4,4,0]} maxBarSize={24}>
                {stats.rcaData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-box full-width">
          <h4>Pareto — top downtime contributors</h4>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={stats.paretoData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
              <XAxis dataKey="id" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} domain={[0, 100]} />
              <RechartsTooltip cursor={{fill: '#1e293b'}} contentStyle={{background: '#0f172a', border: 'none'}} />
              <Bar yAxisId="left" dataKey="durationMin" fill="#ef4444" name="Duration (Min)" radius={[4,4,0,0]} maxBarSize={40} />
              <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#fbbf24" strokeWidth={3} dot={{r:4, fill:'#fbbf24', strokeWidth:0}} name="Cumulative %" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top 10 Table */}
      <div className="tpm-table-section">
        <h4>Top 10 longest stoppages</h4>
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
                        {documented ? 'RCA Documented' : 'Pending RCA'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Methodology Section */}
      <div className="tpm-methodology">
        <details>
          <summary>How these numbers are calculated</summary>
          <div className="details-content">
            <p><strong>Total downtime:</strong> Sum of all parsed event durations across the selected period.</p>
            <p><strong>MTTR (Mean Time to Repair):</strong> Average duration of "Breakdown" category events only.</p>
            <p><strong>Avg time between breakdowns:</strong> Rough proxy of MTBF calculated as timespan between first and last breakdown divided by breakdown count.</p>
            <p><strong>Root-cause documented:</strong> Percentage of events where the Reason/Action text is filled vs empty or pending.</p>
            <p><strong>Pareto analysis:</strong> Events sorted by duration, with cumulative percentage showing the impact of the top few events.</p>
          </div>
        </details>
      </div>

    </div>
  );
};
