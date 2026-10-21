import React, { useEffect, useState, useMemo } from 'react';
import {
  HierarchyPlant,
  HierarchyDepartment,
  HierarchyLine,
  HierarchyMachine,
  HierarchyCamera,
  fetchHierarchy,
  createPlant, updatePlant, deletePlant,
  createDepartment, updateDepartment, deleteDepartment,
  createLine, updateLine, deleteLine,
  createMachine, updateMachine, deleteMachine,
  createCamera, updateCamera, deleteCamera,
  testCameraConnection, testPlcConnection,
  hierarchyCameraSnapshotUrl
} from './api';

export function HierarchyManager({ onBack }: { onBack?: () => void } = {}) {
  const [plants, setPlants] = useState<HierarchyPlant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [camSnapshotTick, setCamSnapshotTick] = useState(Date.now());
  const [activeTab, setActiveTab] = useState<'form' | 'tree'>('form');
  const [selectedPlantFilter, setSelectedPlantFilter] = useState<number | 'all'>('all');

  useEffect(() => {
    const iv = setInterval(() => setCamSnapshotTick(Date.now()), 3000);
    return () => clearInterval(iv);
  }, []);

  // Flattened cameras with location context
  const allCameras = useMemo(() => {
    const list: Array<{
      cam: HierarchyCamera;
      plant: HierarchyPlant;
      dept: HierarchyDepartment;
      line: HierarchyLine;
      machine: HierarchyMachine;
    }> = [];
    plants.forEach(plant => {
      plant.departments.forEach(dept => {
        dept.lines.forEach(line => {
          line.machines.forEach(machine => {
            machine.cameras.forEach(cam => {
              list.push({ cam, plant, dept, line, machine });
            });
          });
        });
      });
    });
    return list;
  }, [plants]);

  // Expanded nodes state for tree view
  const [expandedPlants, setExpandedPlants] = useState<Record<number, boolean>>({});
  const [expandedDepts, setExpandedDepts] = useState<Record<number, boolean>>({});
  const [expandedLines, setExpandedLines] = useState<Record<number, boolean>>({});

  // Active modal
  const [modalType, setModalType] = useState<
    'addPlant' | 'editPlant' |
    'addDept' | 'editDept' |
    'addLine' | 'editLine' |
    'addMachine' | 'editMachine' |
    'addCam' | 'editCam' | null
  >(null);

  // Modal form payloads
  const [plantForm, setPlantForm] = useState({ id: 0, code: '', name: '', location: '' });
  const [deptForm, setDeptForm] = useState({ id: 0, plant_id: 0, code: '', name: '' });
  const [lineForm, setLineForm] = useState({ id: 0, department_id: 0, code: '', name: '' });
  const [machineForm, setMachineForm] = useState({
    id: 0, line_id: 0, code: '', name: '', plc_enabled: true, plc_host: '192.168.117.201', plc_port: 5000, plc_device: 'X', plc_address: '4A'
  });
  const [camForm, setCamForm] = useState({
    id: 0, machine_id: 0, name: '', camera_ip: '', http_port: 80, rtsp_port: 554,
    username: 'admin', password: 'Admin@123', channel: 1, rtsp_path: '/video/live?channel=1&subtype=0', sub_rtsp_path: '/video/live?channel=1&subtype=1'
  });

  // Dedicated Quick Onboarding Form State
  const [quickPlantId, setQuickPlantId] = useState<number>(0);
  const [quickDeptId, setQuickDeptId] = useState<number>(0);
  const [quickLineId, setQuickLineId] = useState<number>(0);
  const [quickMachineId, setQuickMachineId] = useState<number | 'new'>(0);
  const [quickNewMachineName, setQuickNewMachineName] = useState<string>('');
  const [quickNewMachineCode, setQuickNewMachineCode] = useState<string>('');
  const [quickCamName, setQuickCamName] = useState('');
  const [quickCamIp, setQuickCamIp] = useState('192.168.119.205');
  const [quickHttpPort, setQuickHttpPort] = useState(80);
  const [quickRtspPort, setQuickRtspPort] = useState(554);
  const [quickUsername, setQuickUsername] = useState('admin');
  const [quickPassword, setQuickPassword] = useState('Admin@123');
  const [quickChannel, setQuickChannel] = useState(1);
  const [quickRtspPath, setQuickRtspPath] = useState('/video/live?channel=1&subtype=0');
  const [quickTesting, setQuickTesting] = useState(false);
  const [quickTestResult, setQuickTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);

  // General connection test state (used in modal)
  const [testTesting, setTestTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const reloadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHierarchy();
      setPlants(data);
      const expP: Record<number, boolean> = {};
      const expD: Record<number, boolean> = {};
      const expL: Record<number, boolean> = {};
      data.forEach(p => {
        expP[p.id] = true;
        p.departments.forEach(d => {
          expD[d.id] = true;
          d.lines.forEach(l => {
            expL[l.id] = true;
          });
        });
      });
      setExpandedPlants(expP);
      setExpandedDepts(expD);
      setExpandedLines(expL);

      // Auto-set initial selections for quick onboarding form
      if (data.length > 0) {
        setQuickPlantId(prev => prev && data.some(p => p.id === prev) ? prev : data[0].id);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load hierarchy');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadData();
  }, []);

  // Cascading lists for Quick Onboarding Form
  const selectedPlant = useMemo(() => plants.find(p => p.id === quickPlantId) || plants[0], [plants, quickPlantId]);
  const availableDepts = useMemo(() => selectedPlant?.departments || [], [selectedPlant]);
  const selectedDept = useMemo(() => availableDepts.find(d => d.id === quickDeptId) || availableDepts[0], [availableDepts, quickDeptId]);
  const availableLines = useMemo(() => selectedDept?.lines || [], [selectedDept]);
  const selectedLine = useMemo(() => availableLines.find(l => l.id === quickLineId) || availableLines[0], [availableLines, quickLineId]);
  const availableMachines = useMemo(() => selectedLine?.machines || [], [selectedLine]);

  // Keep dropdowns in sync
  useEffect(() => {
    if (availableDepts.length > 0 && (!quickDeptId || !availableDepts.some(d => d.id === quickDeptId))) {
      setQuickDeptId(availableDepts[0].id);
    }
  }, [availableDepts, quickDeptId]);

  useEffect(() => {
    if (availableLines.length > 0 && (!quickLineId || !availableLines.some(l => l.id === quickLineId))) {
      setQuickLineId(availableLines[0].id);
    }
  }, [availableLines, quickLineId]);

  useEffect(() => {
    if (availableMachines.length > 0 && (!quickMachineId || quickMachineId === 'new' || !availableMachines.some(m => m.id === quickMachineId))) {
      setQuickMachineId(availableMachines[0].id);
    } else if (availableMachines.length === 0) {
      setQuickMachineId('new');
    }
  }, [availableMachines, quickMachineId]);

  const notify = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4500);
  };

  // --- Handlers: Quick Onboarding Form ---
  const handleQuickTest = async () => {
    if (!quickCamIp) {
      setQuickTestResult({ ok: false, message: 'Please enter a valid Camera IP address first.' });
      return;
    }
    setQuickTesting(true);
    setQuickTestResult(null);
    try {
      const res = await testCameraConnection({
        camera_ip: quickCamIp,
        http_port: quickHttpPort,
        rtsp_port: quickRtspPort,
        username: quickUsername,
        password: quickPassword,
        channel: quickChannel,
        rtsp_path: quickRtspPath,
      });
      setQuickTestResult({
        ok: res.rtsp_stream_ok || (res.rtsp_open && res.http_open),
        message: res.message || (res.rtsp_stream_ok ? 'RTSP stream verified & responsive!' : 'Connection test completed.')
      });
    } catch (err: any) {
      setQuickTestResult({ ok: false, message: err.message || 'Network handshake failed' });
    } finally {
      setQuickTesting(false);
    }
  };

  const handleQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCamName.trim()) {
      alert('Please provide a Camera Name (e.g. Die Area Camera).');
      return;
    }
    if (!quickCamIp.trim()) {
      alert('Please provide a valid Camera IP Address.');
      return;
    }

    setQuickSaving(true);
    try {
      let targetMachineId: number;

      if (quickMachineId === 'new') {
        if (!quickNewMachineName.trim()) {
          alert('Please enter a Machine Name to associate with this camera.');
          setQuickSaving(false);
          return;
        }
        if (!selectedLine) {
          alert('No production line found. Please ensure a Department and Line exist.');
          setQuickSaving(false);
          return;
        }

        const machineCode = quickNewMachineCode.trim() || quickNewMachineName.toUpperCase().replace(/\s+/g, '-');
        const createdMachine = await createMachine({
          line_id: selectedLine.id,
          name: quickNewMachineName.trim(),
          code: machineCode,
          plc_enabled: true,
          plc_host: '192.168.117.201',
          plc_port: 5000,
          plc_device: 'X',
          plc_address: '4A'
        });
        targetMachineId = createdMachine.id;
      } else {
        targetMachineId = Number(quickMachineId);
      }

      await createCamera({
        machine_id: targetMachineId,
        name: quickCamName.trim(),
        camera_ip: quickCamIp.trim(),
        http_port: Number(quickHttpPort),
        rtsp_port: Number(quickRtspPort),
        username: quickUsername,
        password: quickPassword,
        channel: Number(quickChannel),
        rtsp_path: quickRtspPath,
        sub_rtsp_path: `/video/live?channel=${quickChannel}&subtype=1`,
        is_active: true
      });

      notify(`Camera "${quickCamName}" registered and added to ${selectedPlant?.name || 'Plant'}!`);
      setQuickCamName('');
      setQuickNewMachineName('');
      setQuickNewMachineCode('');
      setQuickTestResult(null);
      await reloadData();
    } catch (err: any) {
      alert(err.message || 'Failed to save camera');
    } finally {
      setQuickSaving(false);
    }
  };

  // --- Handlers: Plant ---
  const handleSavePlant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'addPlant') {
        await createPlant({ code: plantForm.code, name: plantForm.name, location: plantForm.location });
        notify(`Plant "${plantForm.name}" created!`);
      } else {
        await updatePlant(plantForm.id, { code: plantForm.code, name: plantForm.name, location: plantForm.location });
        notify(`Plant "${plantForm.name}" updated!`);
      }
      setModalType(null);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    }
  };

  const handleDeletePlant = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to delete Plant "${name}"? All associated departments, lines, and cameras will be removed.`)) return;
    try {
      await deletePlant(id);
      notify(`Plant "${name}" deleted.`);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete plant');
    }
  };

  // --- Handlers: Department ---
  const handleSaveDept = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'addDept') {
        await createDepartment({ plant_id: deptForm.plant_id, code: deptForm.code, name: deptForm.name });
        notify(`Department "${deptForm.name}" created!`);
      } else {
        await updateDepartment(deptForm.id, { code: deptForm.code, name: deptForm.name });
        notify(`Department "${deptForm.name}" updated!`);
      }
      setModalType(null);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    }
  };

  const handleDeleteDept = async (id: number, name: string) => {
    if (!window.confirm(`Delete department "${name}" and all its lines/cameras?`)) return;
    try {
      await deleteDepartment(id);
      notify(`Department "${name}" deleted.`);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete department');
    }
  };

  // --- Handlers: Line ---
  const handleSaveLine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'addLine') {
        await createLine({ department_id: lineForm.department_id, code: lineForm.code, name: lineForm.name });
        notify(`Line "${lineForm.name}" created!`);
      } else {
        await updateLine(lineForm.id, { code: lineForm.code, name: lineForm.name });
        notify(`Line "${lineForm.name}" updated!`);
      }
      setModalType(null);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    }
  };

  const handleDeleteLine = async (id: number, name: string) => {
    if (!window.confirm(`Delete line "${name}"?`)) return;
    try {
      await deleteLine(id);
      notify(`Line "${name}" deleted.`);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete line');
    }
  };

  // --- Handlers: Machine ---
  const handleSaveMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'addMachine') {
        await createMachine(machineForm);
        notify(`Machine "${machineForm.name}" created!`);
      } else {
        await updateMachine(machineForm.id, machineForm);
        notify(`Machine "${machineForm.name}" updated!`);
      }
      setModalType(null);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    }
  };

  const handleDeleteMachine = async (id: number, name: string) => {
    if (!window.confirm(`Delete machine "${name}" and its attached cameras?`)) return;
    try {
      await deleteMachine(id);
      notify(`Machine "${name}" deleted.`);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete machine');
    }
  };

  // --- Handlers: Camera (Edit from Card / Modal) ---
  const handleSaveCam = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'addCam') {
        await createCamera(camForm);
        notify(`Camera "${camForm.name}" added!`);
      } else {
        await updateCamera(camForm.id, camForm);
        notify(`Camera "${camForm.name}" updated!`);
      }
      setModalType(null);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    }
  };

  const handleDeleteCam = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to remove Camera "${name}"?`)) return;
    try {
      await deleteCamera(id);
      notify(`Camera "${name}" removed successfully.`);
      reloadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete camera');
    }
  };

  const handleTestModalCamera = async () => {
    setTestTesting(true);
    setTestResult(null);
    try {
      const res = await testCameraConnection({
        camera_ip: camForm.camera_ip,
        http_port: camForm.http_port,
        rtsp_port: camForm.rtsp_port,
        username: camForm.username,
        password: camForm.password,
        channel: camForm.channel,
        rtsp_path: camForm.rtsp_path,
      });
      setTestResult({
        ok: res.rtsp_stream_ok || (res.rtsp_open && res.http_open),
        message: res.message || (res.rtsp_stream_ok ? 'RTSP stream verified!' : 'Connection test finished.')
      });
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || 'Network test failed' });
    } finally {
      setTestTesting(false);
    }
  };

  // Filtered cameras based on selected plant tab
  const displayedCameras = useMemo(() => {
    if (selectedPlantFilter === 'all') return allCameras;
    return allCameras.filter(c => c.plant.id === selectedPlantFilter);
  }, [allCameras, selectedPlantFilter]);

  return (
    <div className="hierarchy-manager-container" style={{ padding: '24px 32px 36px', maxWidth: '100%', margin: '0 auto', color: '#0f172a', boxSizing: 'border-box' }}>
      
      {/* Top Header Bar (Image 3) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem',
                color: '#0f172a',
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
              }}
              title="Back to Live View"
            >
              ←
            </button>
          )}
          <div>
            <h2 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Plant & Camera Setup
            </h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.92rem' }}>
              Quickly register new IP Cameras with live testing, and monitor all configured cameras plant-wise.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setActiveTab('form')}
            style={{
              padding: '9px 18px',
              background: activeTab === 'form' ? '#1d4ed8' : '#ffffff',
              color: activeTab === 'form' ? '#ffffff' : '#334155',
              border: activeTab === 'form' ? 'none' : '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '0.86rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: activeTab === 'form' ? '0 2px 6px rgba(29, 78, 216, 0.3)' : '0 1px 2px rgba(0,0,0,0.03)'
            }}
          >
            <span>📋</span> Quick Camera Form
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tree')}
            style={{
              padding: '9px 18px',
              background: activeTab === 'tree' ? '#1d4ed8' : '#ffffff',
              color: activeTab === 'tree' ? '#ffffff' : '#334155',
              border: activeTab === 'tree' ? 'none' : '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '0.86rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: activeTab === 'tree' ? '0 2px 6px rgba(29, 78, 216, 0.3)' : '0 1px 2px rgba(0,0,0,0.03)'
            }}
          >
            <span>🌿</span> Hierarchy Tree
          </button>

          <button
            type="button"
            onClick={reloadData}
            style={{
              padding: '9px 18px',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#334155',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.86rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
            }}
          >
            🔄 Refresh
          </button>

          <button
            type="button"
            onClick={() => {
              setPlantForm({ id: 0, code: '', name: '', location: '' });
              setModalType('addPlant');
            }}
            style={{
              padding: '9px 18px',
              background: '#1d4ed8',
              border: 'none',
              color: '#ffffff',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.86rem',
              boxShadow: '0 2px 6px rgba(29, 78, 216, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>+</span> Add Plant
          </button>
        </div>
      </div>

      {/* Notifications Banner */}
      {successMsg && (
        <div style={{ padding: '12px 20px', background: 'rgba(16, 185, 129, 0.16)', border: '1px solid #10b981', color: '#34d399', borderRadius: '10px', marginBottom: '20px', fontWeight: 600, fontSize: '0.96rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>✅</span> {successMsg}
        </div>
      )}
      {error && (
        <div style={{ padding: '12px 20px', background: 'rgba(239, 68, 68, 0.16)', border: '1px solid #ef4444', color: '#f87171', borderRadius: '10px', marginBottom: '20px', fontWeight: 600, fontSize: '0.96rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>⚠️</span> {error}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: QUICK CAMERA ONBOARDING FORM & PLANT-WISE CARDS DECK (DEFAULT)     */}
      {/* ========================================================================= */}
      {activeTab === 'form' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          
          {/* 1. PROFESSIONAL "ADD NEW CAMERA" FORM CARD (White Elevated Card - Image 3) */}
          <div style={{
            background: '#ffffff',
            border: '1.5px solid #e2e8f0',
            borderTop: '3.5px solid #2563eb',
            borderRadius: '14px',
            padding: '24px 28px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.4rem', background: '#eff6ff', padding: '6px 10px', borderRadius: '8px', color: '#1d4ed8' }}>📹</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                    Add New Camera Configuration
                  </h3>
                  <p style={{ margin: '3px 0 0', color: '#64748b', fontSize: '0.84rem' }}>
                    Select target Plant & Line, enter camera network credentials, test the live RTSP stream, and connect in 1-click.
                  </p>
                </div>
              </div>

              <span style={{ fontSize: '0.8rem', color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '5px 14px', borderRadius: '99px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span>ℹ️</span> Auto RTSP Handshake
              </span>
            </div>

            <form onSubmit={handleQuickSubmit}>
              {/* Row 1: Hierarchy Association (Plant -> Dept -> Line -> Machine) */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '4px 12px', borderRadius: '6px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1d4ed8' }}>
                    1. Plant & Production Machine Association
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                  {/* Plant Select */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.84rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>
                      🏭 Plant:
                    </label>
                    <select
                      value={quickPlantId}
                      onChange={e => {
                        const val = Number(e.target.value);
                        setQuickPlantId(val);
                      }}
                      style={formInputStyle}
                    >
                      {plants.map(p => (
                        <option key={p.id} value={p.id} >{p.name} ({p.code})</option>
                      ))}
                    </select>
                  </div>

                  {/* Dept Select */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.84rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>
                      🏢 Department:
                    </label>
                    <select
                      value={quickDeptId}
                      onChange={e => setQuickDeptId(Number(e.target.value))}
                      style={formInputStyle}
                    >
                      {availableDepts.length > 0 ? (
                        availableDepts.map(d => (
                          <option key={d.id} value={d.id} >{d.name}</option>
                        ))
                      ) : (
                        <option value={0} >No Departments</option>
                      )}
                    </select>
                  </div>

                  {/* Line Select */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.84rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>
                      ⚙️ Production Line:
                    </label>
                    <select
                      value={quickLineId}
                      onChange={e => setQuickLineId(Number(e.target.value))}
                      style={formInputStyle}
                    >
                      {availableLines.length > 0 ? (
                        availableLines.map(l => (
                          <option key={l.id} value={l.id} >{l.name}</option>
                        ))
                      ) : (
                        <option value={0} >No Lines</option>
                      )}
                    </select>
                  </div>

                  {/* Machine Select or Create */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.84rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>
                      ⚡ Machine Workcell:
                    </label>
                    <select
                      value={quickMachineId}
                      onChange={e => setQuickMachineId(e.target.value === 'new' ? 'new' : Number(e.target.value))}
                      style={formInputStyle}
                    >
                      {availableMachines.map(m => (
                        <option key={m.id} value={m.id} >{m.name} ({m.code})</option>
                      ))}
                      <option value="new" style={{ color: '#1d4ed8', fontWeight: 700 }}>+ Add New Machine...</option>
                    </select>
                  </div>
                </div>

                {/* Inline New Machine Fields if "new" is picked */}
                {quickMachineId === 'new' && (
                  <div style={{ marginTop: '12px', padding: '14px 18px', background: 'rgba(2, 132, 199, 0.12)', border: '1px dashed #0284c7', borderRadius: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', color: '#38bdf8', fontWeight: 700, marginBottom: '4px' }}>New Machine Name:</label>
                      <input
                        required
                        placeholder="e.g. UBE 850 T - 03"
                        value={quickNewMachineName}
                        onChange={e => setQuickNewMachineName(e.target.value)}
                        style={formInputStyle}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', color: '#38bdf8', fontWeight: 700, marginBottom: '4px' }}>Machine Code:</label>
                      <input
                        placeholder="e.g. UBE-850T-03"
                        value={quickNewMachineCode}
                        onChange={e => setQuickNewMachineCode(e.target.value)}
                        style={formInputStyle}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Row 2: Camera Name, IP, Username, Password */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '4px 12px', borderRadius: '6px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1d4ed8' }}>
                    2. Camera Identity & Network Credentials
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.84rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>
                      Camera Name / View Label:
                    </label>
                    <input
                      required
                      placeholder="e.g. Die Area Camera, Mould View"
                      value={quickCamName}
                      onChange={e => setQuickCamName(e.target.value)}
                      style={formInputStyle}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.84rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>
                      Camera IP Address:
                    </label>
                    <input
                      required
                      placeholder="e.g. 192.168.119.205"
                      value={quickCamIp}
                      onChange={e => setQuickCamIp(e.target.value)}
                      style={formInputStyle}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.84rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>
                      Username:
                    </label>
                    <input
                      required
                      placeholder="admin"
                      value={quickUsername}
                      onChange={e => setQuickUsername(e.target.value)}
                      style={formInputStyle}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.84rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>
                      Password:
                    </label>
                    <input
                      required
                      type="password"
                      placeholder="Admin@123"
                      value={quickPassword}
                      onChange={e => setQuickPassword(e.target.value)}
                      style={formInputStyle}
                    />
                  </div>
                </div>
              </div>

              {/* Row 3: Ports & RTSP Channel settings (Collapsible/Advanced compact) */}
              <div style={{ marginBottom: '22px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '4px 12px', borderRadius: '6px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1d4ed8' }}>
                    3. Stream Protocols & Ports
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>RTSP Port:</label>
                    <input
                      type="number"
                      value={quickRtspPort}
                      onChange={e => setQuickRtspPort(Number(e.target.value))}
                      style={formInputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>HTTP Port:</label>
                    <input
                      type="number"
                      value={quickHttpPort}
                      onChange={e => setQuickHttpPort(Number(e.target.value))}
                      style={formInputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>Channel:</label>
                    <input
                      type="number"
                      value={quickChannel}
                      onChange={e => setQuickChannel(Number(e.target.value))}
                      style={formInputStyle}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>RTSP Path:</label>
                    <input
                      value={quickRtspPath}
                      onChange={e => setQuickRtspPath(e.target.value)}
                      style={formInputStyle}
                    />
                  </div>
                </div>
              </div>

              {/* Row 4: Live Test Feedback & Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    type="button"
                    onClick={handleQuickTest}
                    disabled={quickTesting}
                    style={{
                      padding: '10px 20px',
                      background: '#ffffff',
                      border: '1.5px solid #93c5fd',
                      color: '#1d4ed8',
                      borderRadius: '8px',
                      cursor: quickTesting ? 'wait' : 'pointer',
                      fontWeight: 700,
                      fontSize: '0.92rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span>{quickTesting ? '⏳' : '⚡'}</span>
                    <span>{quickTesting ? 'Testing RTSP & Ping...' : 'Test Connection'}</span>
                  </button>

                  {quickTestResult && (
                    <div style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      background: quickTestResult.ok ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)',
                      border: `1px solid ${quickTestResult.ok ? '#10b981' : '#ef4444'}`,
                      color: quickTestResult.ok ? '#34d399' : '#f87171',
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <span>{quickTestResult.ok ? '✅' : '⚠️'}</span>
                      <span>{quickTestResult.message}</span>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={quickSaving}
                  style={{
                    padding: '12px 28px',
                    background: '#1d4ed8',
                    border: 'none',
                    color: '#ffffff',
                    borderRadius: '8px',
                    cursor: quickSaving ? 'wait' : 'pointer',
                    fontWeight: 800,
                    fontSize: '1rem',
                    boxShadow: '0 4px 16px rgba(37,99,235,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s'
                  }}
                >
                  <span>{quickSaving ? '⏳' : '➕'}</span>
                  <span>{quickSaving ? 'Saving Camera...' : 'Add Camera to Plant'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* 2. CONFIGURED CAMERAS OVERVIEW (PLANT-WISE SECTION - Image 3) */}
          <div style={{
            background: '#ffffff',
            border: '1.5px solid #e2e8f0',
            borderTop: '3.5px solid #059669',
            borderRadius: '14px',
            padding: '24px 28px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}>
            {/* Header & Plant Tabs Filter */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '1.3rem', color: '#1e3a8a' }}>📹</span>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                    Configured Cameras by Plant
                  </h3>
                  <span style={{
                    background: '#dbeafe', color: '#1d4ed8',
                    fontSize: '0.8rem', padding: '3px 12px', borderRadius: '12px', fontWeight: 700
                  }}>
                    {allCameras.length} Total Configured
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.84rem' }}>
                  Browse active cameras plant-wise with live RTSP stream previews and edit configurations.
                </p>
              </div>

              {/* Plant Filter Tabs */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setSelectedPlantFilter('all')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    border: selectedPlantFilter === 'all' ? 'none' : '1px solid #cbd5e1',
                    background: selectedPlantFilter === 'all' ? '#1d4ed8' : '#ffffff',
                    color: selectedPlantFilter === 'all' ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                    boxShadow: selectedPlantFilter === 'all' ? '0 2px 6px rgba(29, 78, 216, 0.25)' : 'none'
                  }}
                >
                  All Plants ({allCameras.length})
                </button>
                {plants.map(p => {
                  const pCount = allCameras.filter(c => c.plant.id === p.id).length;
                  const isActive = selectedPlantFilter === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPlantFilter(p.id)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '8px',
                        border: isActive ? 'none' : '1px solid #cbd5e1',
                        background: isActive ? '#1d4ed8' : '#ffffff',
                        color: isActive ? '#ffffff' : '#475569',
                        cursor: 'pointer',
                        fontSize: '0.84rem',
                        fontWeight: 700,
                        transition: 'all 0.18s',
                        boxShadow: isActive ? '0 2px 6px rgba(29, 78, 216, 0.25)' : 'none'
                      }}
                    >
                      🏭 {p.name} ({pCount})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cameras Deck Cards Grid */}
            {displayedCameras.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: '12px' }}>
                <p style={{ color: '#64748b', fontSize: '0.95rem', margin: 0, fontWeight: 500 }}>
                  No cameras registered under the selected plant yet. Use the form above to add a camera!
                </p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))',
                gap: '18px'
              }}>
                {displayedCameras.map(({ cam, plant, dept, line, machine }) => (
                  <div
                    key={cam.id}
                    style={{
                      background: '#ffffff',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '16px 20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                      transition: 'all 0.2s ease',
                      position: 'relative'
                    }}
                  >
                    {/* Header: Plant & Machine Pills */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '0.8rem', color: '#1d4ed8', background: '#eff6ff',
                        border: '1px solid #bfdbfe', padding: '3px 10px', borderRadius: '6px', fontWeight: 700,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        ⚙️ {machine.name}
                      </span>
                      <span style={{
                        color: '#059669', fontSize: '0.74rem', background: '#ecfdf5',
                        border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '6px', fontWeight: 700
                      }}>
                        ● RTSP LIVE
                      </span>
                    </div>

                    {/* Snapshot + Camera Details */}
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                      <div
                        style={{
                          width: '120px',
                          height: '80px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          background: '#f1f5f9',
                          border: '1.5px solid #cbd5e1',
                          flexShrink: 0,
                          position: 'relative'
                        }}
                      >
                        <img
                          src={`${hierarchyCameraSnapshotUrl(cam.id)}&t=${camSnapshotTick}`}
                          alt={cam.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        <span style={{
                          position: 'absolute', bottom: '3px', left: '3px',
                          background: 'rgba(0,0,0,0.85)', color: '#34d399',
                          fontSize: '0.68rem', padding: '1px 5px', borderRadius: '3px', fontWeight: 800
                        }}>
                          CH 0{cam.channel}
                        </span>
                      </div>

                      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{
                          fontWeight: 800, fontSize: '1.08rem', color: '#0f172a',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                        }} title={cam.name}>
                          {cam.name}
                        </div>

                        <div style={{ fontSize: '0.86rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: '#2563eb', fontWeight: 700 }}>IP:</span>
                          <strong style={{ color: '#0f172a' }}>{cam.camera_ip}:{cam.rtsp_port}</strong>
                        </div>

                        <div style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          🏭 {plant.name} • {line.name}
                        </div>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: '8px',
                      paddingTop: '12px',
                      borderTop: '1.5px solid #f1f5f9'
                    }}>
                      <button
                        type="button"
                        onClick={() => {
                          setCamForm({
                            id: cam.id, machine_id: machine.id, name: cam.name, camera_ip: cam.camera_ip,
                            http_port: cam.http_port, rtsp_port: cam.rtsp_port, username: cam.username,
                            password: cam.password || 'Admin@123', channel: cam.channel,
                            rtsp_path: cam.rtsp_path, sub_rtsp_path: cam.sub_rtsp_path || '/video/live?channel=1&subtype=1'
                          });
                          setTestResult(null);
                          setModalType('editCam');
                        }}
                        style={{
                          padding: '7px 16px',
                          background: '#ffffff',
                          border: '1.5px solid #cbd5e1',
                          color: '#1d4ed8',
                          borderRadius: '8px',
                          fontSize: '0.86rem',
                          cursor: 'pointer',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.2s',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
                        }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCam(cam.id, cam.name)}
                        style={{
                          padding: '7px 14px',
                          background: '#ffffff',
                          border: '1.5px solid #fecaca',
                          color: '#dc2626',
                          borderRadius: '8px',
                          fontSize: '0.86rem',
                          cursor: 'pointer',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.2s',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
                        }}
                      >
                        🗑️ Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: FULL HIERARCHY TREE VIEW (PLANTS -> DEPTS -> LINES -> MACHINES)    */}
      {/* ========================================================================= */}
      {activeTab === 'tree' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {plants.map(plant => (
            <div key={plant.id} style={{ background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
              {/* Plant Header */}
              <div style={{ padding: '16px 22px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', borderBottom: '1.5px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={() => setExpandedPlants(p => ({ ...p, [plant.id]: !p[plant.id] }))}
                    style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '1.2rem', cursor: 'pointer', padding: '4px' }}
                  >
                    {expandedPlants[plant.id] ? '▼' : '▶'}
                  </button>
                  <span style={{ fontSize: '1.5rem' }}>🏢</span>
                  <div>
                    <strong style={{ fontSize: '1.2rem', color: '#0f172a', fontWeight: 800 }}>{plant.name}</strong>
                    <span style={{ marginLeft: '10px', fontSize: '0.8rem', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '3px 8px', borderRadius: '6px', color: '#1d4ed8', fontWeight: 700 }}>
                      Code: {plant.code}
                    </span>
                    {plant.location && <span style={{ marginLeft: '12px', fontSize: '0.84rem', color: '#64748b', fontWeight: 500 }}>📍 {plant.location}</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => {
                      setDeptForm({ id: 0, plant_id: plant.id, code: '', name: '' });
                      setModalType('addDept');
                    }}
                    style={{ padding: '7px 14px', background: '#2563eb', border: 'none', color: '#fff', borderRadius: '8px', fontSize: '0.84rem', cursor: 'pointer', fontWeight: 700, boxShadow: '0 1px 3px rgba(37,99,235,0.2)' }}
                  >
                    + Add Dept
                  </button>
                  <button
                    onClick={() => {
                      setPlantForm({ id: plant.id, code: plant.code, name: plant.name, location: plant.location || '' });
                      setModalType('editPlant');
                    }}
                    style={{ padding: '7px 12px', background: '#ffffff', border: '1.5px solid #cbd5e1', color: '#475569', borderRadius: '8px', fontSize: '0.84rem', cursor: 'pointer', fontWeight: 600 }}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleDeletePlant(plant.id, plant.name)}
                    style={{ padding: '7px 10px', background: '#ffffff', border: '1.5px solid #fecaca', color: '#dc2626', borderRadius: '8px', fontSize: '0.84rem', cursor: 'pointer', fontWeight: 700 }}
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Departments under Plant */}
              {expandedPlants[plant.id] && (
                <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {plant.departments.length === 0 ? (
                    <div style={{ color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic', padding: '10px' }}>No departments added yet.</div>
                  ) : (
                    plant.departments.map(dept => (
                      <div key={dept.id} style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '14px 18px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <button
                              onClick={() => setExpandedDepts(d => ({ ...d, [dept.id]: !d[dept.id] }))}
                              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '1rem', cursor: 'pointer' }}
                            >
                              {expandedDepts[dept.id] ? '▼' : '▶'}
                            </button>
                            <span style={{ fontSize: '1.25rem' }}>🏭</span>
                            <strong style={{ fontSize: '1.05rem', color: '#0f172a', fontWeight: 700 }}>{dept.name}</strong>
                            <span style={{ fontSize: '0.78rem', background: '#ffffff', border: '1px solid #cbd5e1', padding: '2px 6px', borderRadius: '4px', color: '#64748b' }}>{dept.code}</span>
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => {
                                setLineForm({ id: 0, department_id: dept.id, code: '', name: '' });
                                setModalType('addLine');
                              }}
                              style={{ padding: '6px 12px', background: '#0284c7', border: 'none', color: '#fff', borderRadius: '7px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 700 }}
                            >
                              + Add Line
                            </button>
                            <button
                              onClick={() => {
                                setDeptForm({ id: dept.id, plant_id: plant.id, code: dept.code, name: dept.name });
                                setModalType('editDept');
                              }}
                              style={{ padding: '6px 10px', background: '#ffffff', border: '1.5px solid #cbd5e1', color: '#475569', borderRadius: '7px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600 }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              onClick={() => handleDeleteDept(dept.id, dept.name)}
                              style={{ padding: '6px 8px', background: '#ffffff', border: '1.5px solid #fecaca', color: '#dc2626', borderRadius: '7px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 700 }}
                            >
                              🗑️
                            </button>
                          </div>
                        </div>

                        {/* Lines under Department */}
                        {expandedDepts[dept.id] && (
                          <div style={{ marginTop: '12px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {dept.lines.length === 0 ? (
                              <div style={{ color: '#64748b', fontSize: '0.86rem', fontStyle: 'italic' }}>No lines yet. Click "+ Add Line".</div>
                            ) : (
                              dept.lines.map(line => (
                                <div key={line.id} style={{ background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <button
                                        onClick={() => setExpandedLines(l => ({ ...l, [line.id]: !l[line.id] }))}
                                        style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '0.9rem', cursor: 'pointer' }}
                                      >
                                        {expandedLines[line.id] ? '▼' : '▶'}
                                      </button>
                                      <span style={{ fontSize: '1.1rem' }}>⚙️</span>
                                      <strong style={{ fontSize: '0.98rem', color: '#0f172a', fontWeight: 700 }}>{line.name}</strong>
                                      <span style={{ fontSize: '0.76rem', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '2px 5px', borderRadius: '3px', color: '#64748b' }}>{line.code}</span>
                                    </div>

                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <button
                                        onClick={() => {
                                          setMachineForm({ id: 0, line_id: line.id, code: '', name: '', plc_enabled: true, plc_host: '192.168.117.201', plc_port: 5000, plc_device: 'X', plc_address: '4A' });
                                          setModalType('addMachine');
                                        }}
                                        style={{ padding: '5px 11px', background: '#059669', border: 'none', color: '#fff', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 700 }}
                                      >
                                        + Add Machine
                                      </button>
                                      <button
                                        onClick={() => {
                                          setLineForm({ id: line.id, department_id: dept.id, code: line.code, name: line.name });
                                          setModalType('editLine');
                                        }}
                                        style={{ padding: '5px 9px', background: '#ffffff', border: '1.5px solid #cbd5e1', color: '#475569', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600 }}
                                      >
                                        ✏️ Edit
                                      </button>
                                      <button
                                        onClick={() => handleDeleteLine(line.id, line.name)}
                                        style={{ padding: '5px 8px', background: '#ffffff', border: '1.5px solid #fecaca', color: '#dc2626', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 700 }}
                                      >
                                        🗑️
                                      </button>
                                    </div>
                                  </div>

                                  {/* Machines under Line */}
                                  {expandedLines[line.id] && (
                                    <div style={{ marginTop: '10px', paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                      {line.machines.length === 0 ? (
                                        <div style={{ color: '#64748b', fontSize: '0.84rem', fontStyle: 'italic' }}>No machines on this line. Click "+ Add Machine".</div>
                                      ) : (
                                        line.machines.map(mch => (
                                          <div key={mch.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 14px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span>⚡</span>
                                                <strong style={{ fontSize: '0.94rem', color: '#0f172a', fontWeight: 700 }}>{mch.name}</strong>
                                                <span style={{ fontSize: '0.76rem', color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '3px', fontWeight: 600 }}>[{mch.code}]</span>
                                              </div>

                                              <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                  onClick={() => {
                                                    setCamForm({
                                                      id: 0, machine_id: mch.id, name: `${mch.name} Cam`, camera_ip: '192.168.119.205', http_port: 80, rtsp_port: 554,
                                                      username: 'admin', password: 'Admin@123', channel: 1, rtsp_path: '/video/live?channel=1&subtype=0', sub_rtsp_path: '/video/live?channel=1&subtype=1'
                                                    });
                                                    setTestResult(null);
                                                    setModalType('addCam');
                                                  }}
                                                  style={{ padding: '5px 11px', background: '#2563eb', border: 'none', color: '#fff', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 700 }}
                                                >
                                                  📹 + Add Camera
                                                </button>
                                                <button
                                                  onClick={() => {
                                                    setMachineForm({
                                                      id: mch.id, line_id: mch.line_id, code: mch.code, name: mch.name,
                                                      plc_enabled: mch.plc_enabled, plc_host: mch.plc_host || '', plc_port: mch.plc_port,
                                                      plc_device: mch.plc_device, plc_address: mch.plc_address
                                                    });
                                                    setTestResult(null);
                                                    setModalType('editMachine');
                                                  }}
                                                  style={{ padding: '5px 9px', background: '#ffffff', border: '1.5px solid #cbd5e1', color: '#475569', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600 }}
                                                >
                                                  ✏️
                                                </button>
                                                <button
                                                  onClick={() => handleDeleteMachine(mch.id, mch.name)}
                                                  style={{ padding: '5px 8px', background: '#ffffff', border: '1.5px solid #fecaca', color: '#dc2626', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 700 }}
                                                >
                                                  🗑️
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DIALOGS (FOR PLANT, DEPT, LINE, MACHINE, CAMERA EDIT)               */}
      {/* ========================================================================= */}

      {/* Plant Modal */}
      {(modalType === 'addPlant' || modalType === 'editPlant') && (
        <div className="modal-backdrop" style={modalBackdropStyle}>
          <div className="modal-card" style={modalCardStyle}>
            <h3 style={{ margin: '0 0 16px', color: '#0f172a', fontWeight: 800 }}>{modalType === 'addPlant' ? '🏢 Add New Plant' : '🏢 Edit Plant'}</h3>
            <form onSubmit={handleSavePlant}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Plant Code (e.g. 1008, PLANT_01):</label>
                <input required style={inputStyle} value={plantForm.code} onChange={e => setPlantForm({ ...plantForm, code: e.target.value })} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Plant Name (e.g. Rico Bawal, Rico Gurgaon):</label>
                <input required style={inputStyle} value={plantForm.name} onChange={e => setPlantForm({ ...plantForm, name: e.target.value })} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Location / Address:</label>
                <input style={inputStyle} value={plantForm.location} onChange={e => setPlantForm({ ...plantForm, location: e.target.value })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" onClick={() => setModalType(null)} style={cancelBtnStyle}>Cancel</button>
                <button type="submit" style={submitBtnStyle}>Save Plant</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Department Modal */}
      {(modalType === 'addDept' || modalType === 'editDept') && (
        <div className="modal-backdrop" style={modalBackdropStyle}>
          <div className="modal-card" style={modalCardStyle}>
            <h3 style={{ margin: '0 0 16px', color: '#0f172a', fontWeight: 800 }}>{modalType === 'addDept' ? '🏭 Add Department' : '🏭 Edit Department'}</h3>
            <form onSubmit={handleSaveDept}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Department Code (e.g. HPDC, MACH):</label>
                <input required style={inputStyle} value={deptForm.code} onChange={e => setDeptForm({ ...deptForm, code: e.target.value })} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Department Name (e.g. HPDC Casting, Machining):</label>
                <input required style={inputStyle} value={deptForm.name} onChange={e => setDeptForm({ ...deptForm, name: e.target.value })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" onClick={() => setModalType(null)} style={cancelBtnStyle}>Cancel</button>
                <button type="submit" style={submitBtnStyle}>Save Department</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Line Modal */}
      {(modalType === 'addLine' || modalType === 'editLine') && (
        <div className="modal-backdrop" style={modalBackdropStyle}>
          <div className="modal-card" style={modalCardStyle}>
            <h3 style={{ margin: '0 0 16px', color: '#0f172a', fontWeight: 800 }}>{modalType === 'addLine' ? '⚙️ Add Production Line' : '⚙️ Edit Line'}</h3>
            <form onSubmit={handleSaveLine}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Line Code (e.g. LINE_01, LINE_HPDC_MED):</label>
                <input required style={inputStyle} value={lineForm.code} onChange={e => setLineForm({ ...lineForm, code: e.target.value })} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Line Name (e.g. HPDC Medium Tonnage):</label>
                <input required style={inputStyle} value={lineForm.name} onChange={e => setLineForm({ ...lineForm, name: e.target.value })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" onClick={() => setModalType(null)} style={cancelBtnStyle}>Cancel</button>
                <button type="submit" style={submitBtnStyle}>Save Line</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Machine Modal */}
      {(modalType === 'addMachine' || modalType === 'editMachine') && (
        <div className="modal-backdrop" style={modalBackdropStyle}>
          <div className="modal-card" style={modalCardStyle}>
            <h3 style={{ margin: '0 0 16px', color: '#0f172a', fontWeight: 800 }}>{modalType === 'addMachine' ? '⚡ Add Machine' : '⚡ Edit Machine'}</h3>
            <form onSubmit={handleSaveMachine}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Machine Code (e.g. UBE-850T-02):</label>
                <input required style={inputStyle} value={machineForm.code} onChange={e => setMachineForm({ ...machineForm, code: e.target.value })} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Machine Name (e.g. UBE 850 T - 02):</label>
                <input required style={inputStyle} value={machineForm.name} onChange={e => setMachineForm({ ...machineForm, name: e.target.value })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" onClick={() => setModalType(null)} style={cancelBtnStyle}>Cancel</button>
                <button type="submit" style={submitBtnStyle}>Save Machine</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Camera Modal (For Edit) */}
      {(modalType === 'addCam' || modalType === 'editCam') && (
        <div className="modal-backdrop" style={modalBackdropStyle}>
          <div className="modal-card" style={modalCardStyle}>
            <h3 style={{ margin: '0 0 16px', color: '#0f172a', fontWeight: 800 }}>{modalType === 'addCam' ? '📹 Add Camera' : '📹 Edit Camera Configuration'}</h3>
            <form onSubmit={handleSaveCam}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Camera Name:</label>
                <input required style={inputStyle} value={camForm.name} onChange={e => setCamForm({ ...camForm, name: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={labelStyle}>Camera IP:</label>
                  <input required style={inputStyle} value={camForm.camera_ip} onChange={e => setCamForm({ ...camForm, camera_ip: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>RTSP Port:</label>
                  <input type="number" style={inputStyle} value={camForm.rtsp_port} onChange={e => setCamForm({ ...camForm, rtsp_port: Number(e.target.value) })} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={labelStyle}>Username:</label>
                  <input style={inputStyle} value={camForm.username} onChange={e => setCamForm({ ...camForm, username: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Password:</label>
                  <input type="password" style={inputStyle} value={camForm.password} onChange={e => setCamForm({ ...camForm, password: e.target.value })} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={labelStyle}>HTTP Port:</label>
                  <input type="number" style={inputStyle} value={camForm.http_port} onChange={e => setCamForm({ ...camForm, http_port: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={labelStyle}>Channel:</label>
                  <input type="number" style={inputStyle} value={camForm.channel} onChange={e => setCamForm({ ...camForm, channel: Number(e.target.value) })} />
                </div>
              </div>

              <div style={fieldGroupStyle}>
                <label style={labelStyle}>RTSP Live Path:</label>
                <input style={inputStyle} value={camForm.rtsp_path} onChange={e => setCamForm({ ...camForm, rtsp_path: e.target.value })} />
              </div>

              {/* Modal Test Connection */}
              <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  onClick={handleTestModalCamera}
                  disabled={testTesting}
                  style={{
                    padding: '8px 16px', background: '#eff6ff', border: '1px solid #bfdbfe',
                    color: '#1d4ed8', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem'
                  }}
                >
                  {testTesting ? 'Testing...' : '⚡ Test Connection'}
                </button>
                {testResult && (
                  <span style={{ fontSize: '0.86rem', color: testResult.ok ? '#15803d' : '#dc2626', fontWeight: 700 }}>
                    {testResult.ok ? '✅' : '⚠️'} {testResult.message}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
                <button type="button" onClick={() => setModalType(null)} style={cancelBtnStyle}>Cancel</button>
                <button type="submit" style={submitBtnStyle}>Save Configuration</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// Inline Form Control Styles
const formInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: '#ffffff',
  border: '1.5px solid #cbd5e1',
  borderRadius: '8px',
  color: '#0f172a',
  fontSize: '0.90rem',
  fontWeight: 600,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'all 0.15s ease'
};

const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
};

const modalCardStyle: React.CSSProperties = {
  background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: '16px',
  padding: '28px 32px', width: '92%', maxWidth: '580px', boxShadow: '0 20px 45px rgba(0,0,0,0.12)',
  color: '#0f172a', maxHeight: '90vh', overflowY: 'auto'
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: '16px'
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.84rem', color: '#475569', marginBottom: '6px', fontWeight: 700
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', background: '#ffffff', border: '1.5px solid #cbd5e1',
  borderRadius: '8px', color: '#0f172a', fontSize: '0.92rem', outline: 'none', boxSizing: 'border-box'
};

const submitBtnStyle: React.CSSProperties = {
  padding: '10px 22px', background: '#2563eb', border: 'none',
  color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.92rem',
  boxShadow: '0 2px 8px rgba(37,99,235,0.25)'
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '10px 18px', background: '#ffffff', border: '1.5px solid #cbd5e1', color: '#475569',
  borderRadius: '8px', cursor: 'pointer', fontSize: '0.92rem', fontWeight: 600
};
