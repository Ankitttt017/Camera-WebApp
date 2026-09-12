import React, { useMemo } from 'react';
import { RecordingRecord } from './api';
import { PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';

interface DashboardProps {
  records: RecordingRecord[];
}

const COLORS = {
  breakdown: '#ef4444', // Danger Red
  minor: '#f59e0b', // Warning Orange
  shiftA: '#8b5cf6',
  shiftB: '#ec4899',
  shiftC: '#14b8a6',
  trend: '#0ea5e9',
};

function formatDuration(seconds: number) {
  if (seconds >= 3600) return (seconds / 3600).toFixed(1) + ' hrs';
  if (seconds >= 60) return (seconds / 60).toFixed(1) + ' min';
  return seconds + ' sec';
}

function eventDuration(record: RecordingRecord) {
  return record.event_duration_seconds || record.duration_seconds || 0;
}

export const Dashboard: React.FC<DashboardProps> = ({ records }) => {
  const stats = useMemo(() => {
    let breakdownCount = 0;
    let minorCount = 0;
    let totalDowntimeSec = 0;
    let longestSec = 0;
    
    // For Hour of Day
    const hourlyCounts = new Array(24).fill(0);
    
    // 1. Line Chart Data (Trend by Date)
    const dailyMap: Record<string, number> = {};
    
    // 2. Shift Data (Bar Chart)
    const shiftMap = { A: 0, B: 0, C: 0 };
    
    // 3. Time Loss by Category (Pie Chart)
    let breakdownDuration = 0;
    let minorDuration = 0;

    records.forEach(r => {
      const isBreakdown = r.event_type === 'breakdown';
      if (isBreakdown) breakdownCount++;
      else minorCount++;
      
      const duration = eventDuration(r);
      totalDowntimeSec += duration;
      if (duration > longestSec) longestSec = duration;

      if (isBreakdown) {
        breakdownDuration += (duration / 60); // minutes
      } else {
        minorDuration += (duration / 60);
      }
      
      if (r.started_at) {
        const d = new Date(r.started_at);
        const hour = d.getHours();
        hourlyCounts[hour]++;
        
        // Trend by date (MM-DD)
        const dateStr = d.toISOString().split('T')[0];
        if (!dailyMap[dateStr]) dailyMap[dateStr] = 0;
        dailyMap[dateStr] += (duration / 60);
        
        // Shift check
        const m = d.getMinutes();
        const timeVal = hour + m / 60;
        if (timeVal >= 6 && timeVal < 14.5) {
          shiftMap.A++;
        } else if (timeVal >= 14.5 && timeVal < 23) {
          shiftMap.B++;
        } else {
          shiftMap.C++;
        }
      }
    });

    const hourlyData = hourlyCounts.map((count, hour) => ({
      name: `${hour}:00`,
      count
    }));

    const trendData = Object.keys(dailyMap).sort().map(date => ({
      date: date.substring(5), // MM-DD
      minutes: Math.round(dailyMap[date])
    }));

    const shiftData = [
      { name: 'Shift A', events: shiftMap.A },
      { name: 'Shift B', events: shiftMap.B },
      { name: 'Shift C', events: shiftMap.C },
    ];
    
    const severityPieData = [
      { name: 'Breakdown', value: Math.round(breakdownDuration) },
      { name: 'Minor Stoppage', value: Math.round(minorDuration) },
    ];

    const pieData = [
      { name: 'Breakdown', value: breakdownCount },
      { name: 'Minor Stoppage', value: minorCount },
    ];
    
    // Sort records by duration to get top 5
    const topRecords = [...records]
      .sort((a, b) => eventDuration(b) - eventDuration(a))
      .slice(0, 5);

    return {
      totalEvents: records.length,
      breakdownCount,
      minorCount,
      totalDowntimeSec,
      avgDurationSec: records.length > 0 ? totalDowntimeSec / records.length : 0,
      longestSec,
      hourlyData,
      pieData,
      topRecords,
      trendData,
      shiftData,
      severityPieData
    };
  }, [records]);

  return (
    <div className="analytics-dashboard">
      <div className="analytics-header">
        <h2>Key Performance Indicators</h2>
        <p>Overview of downtime metrics for the selected period.</p>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-value">{stats.totalEvents}</span>
          <span className="kpi-label">Total Stoppage Events</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{formatDuration(stats.totalDowntimeSec)}</span>
          <span className="kpi-label">Total Downtime</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value" style={{ color: COLORS.breakdown }}>{stats.breakdownCount}</span>
          <span className="kpi-label">Breakdown Events</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value" style={{ color: COLORS.minor }}>{stats.minorCount}</span>
          <span className="kpi-label">Minor Stoppage Events</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{formatDuration(stats.avgDurationSec)}</span>
          <span className="kpi-label">Avg. Event Duration</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{formatDuration(stats.longestSec)}</span>
          <span className="kpi-label">Longest Single Stoppage</span>
        </div>
      </div>

      <div className="charts-grid">
        {/* NEW: Trend Line Chart */}
        <div className="chart-card" style={{ gridColumn: '1 / -1' }}>
          <h3>Downtime Trend Over Time</h3>
          <p>Daily total downtime duration (in minutes)</p>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={stats.trendData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="date" tick={{fontSize: 12, fill: '#9ca3af'}} axisLine={false} tickLine={false} />
                <YAxis tick={{fontSize: 12, fill: '#9ca3af'}} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  itemStyle={{ color: '#f8fafc' }}
                />
                <Line type="monotone" dataKey="minutes" stroke={COLORS.trend} strokeWidth={3} dot={{ r: 4, fill: COLORS.trend, strokeWidth: 0 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Existing: Frequency Donut */}
        <div className="chart-card">
          <h3>Events by Category (Frequency)</h3>
          <p>Share of total stoppage events</p>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={stats.pieData} dataKey="value" cx="50%" cy="50%" innerRadius={80} outerRadius={120} paddingAngle={2}>
                  {stats.pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.name === 'Breakdown' ? COLORS.breakdown : COLORS.minor} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            <span className="legend-item"><i style={{background: COLORS.breakdown}}></i> Breakdown</span>
            <span className="legend-item"><i style={{background: COLORS.minor}}></i> Minor Stoppage</span>
          </div>
        </div>

        {/* NEW: Severity Solid Pie */}
        <div className="chart-card">
          <h3>Time Loss by Category (Severity)</h3>
          <p>Share of total downtime duration (Minutes)</p>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={stats.severityPieData} dataKey="value" cx="50%" cy="50%" outerRadius={120} paddingAngle={0}>
                  {stats.severityPieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.name === 'Breakdown' ? COLORS.breakdown : COLORS.minor} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            <span className="legend-item"><i style={{background: COLORS.breakdown}}></i> Breakdown</span>
            <span className="legend-item"><i style={{background: COLORS.minor}}></i> Minor Stoppage</span>
          </div>
        </div>

        {/* NEW: Shift Bar Chart */}
        <div className="chart-card">
          <h3>Stoppages by Shift</h3>
          <p>Total number of events in each shift</p>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.shiftData} layout="vertical" margin={{ top: 20, right: 30, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.1)" />
                <XAxis type="number" tick={{fontSize: 12, fill: '#9ca3af'}} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{fontSize: 12, fill: '#9ca3af'}} axisLine={false} tickLine={false} width={80} />
                <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} />
                <Bar dataKey="events" radius={[0, 4, 4, 0]}>
                  {stats.shiftData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 0 ? COLORS.shiftA : index === 1 ? COLORS.shiftB : COLORS.shiftC} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Existing: Hourly Bar Chart */}
        <div className="chart-card">
          <h3>Stoppage Pattern by Hour</h3>
          <p>Number of stoppage events starting in each hour</p>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.hourlyData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="name" tick={{fontSize: 12, fill: '#9ca3af'}} axisLine={false} tickLine={false} />
                <YAxis tick={{fontSize: 12, fill: '#9ca3af'}} axisLine={false} tickLine={false} />
                <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="analytics-header mt-8">
        <h2>Longest Stoppages</h2>
        <p>Top events by duration — the longest single contributors to total downtime.</p>
      </div>

      <div className="top-events-table-wrapper">
        <table className="top-events-table">
          <thead>
            <tr>
              <th>Start Date & Time</th>
              <th>Category</th>
              <th>Duration</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {stats.topRecords.map((r, i) => {
              const d = r.started_at ? new Date(r.started_at).toLocaleString() : '-';
              const isBreakdown = r.event_type === 'breakdown';
              return (
                <tr key={r.file_path || i}>
                  <td>{d}</td>
                  <td>
                    <span className={isBreakdown ? 'status-badge bad' : 'status-badge neutral'}>
                      {isBreakdown ? 'Breakdown' : 'Minor Stoppage'}
                    </span>
                  </td>
                  <td><strong>{formatDuration(eventDuration(r))}</strong></td>
                  <td className="reason-cell">{r.reason || 'Pending reason'}</td>
                </tr>
              );
            })}
            {stats.topRecords.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center">No records found for selected period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
