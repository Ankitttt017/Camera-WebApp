import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HierarchyCamera,
  HierarchyDepartment,
  HierarchyLine,
  HierarchyMachine,
  HierarchyPlant,
  RecordingMode,
  RecordingTarget,
  cameraIsRecordingTarget,
  createCamera,
  createDepartment,
  createLine,
  createMachine,
  createPlant,
  deleteCamera,
  deleteDepartment,
  deleteLine,
  deleteMachine,
  deletePlant,
  fetchHierarchy,
  fetchRecordingTarget,
  hierarchyCameraSnapshotUrl,
  setCameraRecordingMode,
  testCameraConnection,
  testPlcConnection,
  updateCamera,
  updateDepartment,
  updateLine,
  updateMachine,
  updatePlant,
} from './api';

/* ------------------------------------------------------------------ helpers */

const NEW = 'new';
const DEFAULT_MAIN_PATH = '/video/live?channel=1&subtype=0';
const DEFAULT_SUB_PATH = '/video/live?channel=1&subtype=1';

type Level = 'plant' | 'department' | 'line' | 'machine';
type Notice = { kind: 'ok' | 'error'; text: string } | null;

function codeFrom(name: string) {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'ITEM';
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

const ICONS: Record<string, string> = {
  plus: 'M12 5v14 M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  reload: 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  camera: 'M4 7h11v10H4z M15 10l5-3v10l-5-3z',
  rec: 'M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z',
  eye: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  plc: 'M5 4h14v16H5z M9 8h6 M9 12h6 M9 16h3',
  close: 'M18 6L6 18M6 6l12 12',
  back: 'M15 18l-6-6 6-6',
};

function Ico({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/* ------------------------------------------------------- camera wizard state */

type PlcFields = { plc_host: string; plc_port: number; plc_device: string; plc_address: string };

type CameraDraft = {
  id?: number;
  plantId: string; newPlantName: string;
  deptId: string; newDeptName: string;
  lineId: string; newLineName: string;
  machineId: string; newMachineName: string;
  name: string; camera_ip: string; username: string; password: string;
  rtsp_port: number; http_port: number; channel: number; rtsp_path: string; sub_rtsp_path: string;
  mode: RecordingMode;
  plc: PlcFields;
};

const EMPTY_PLC: PlcFields = { plc_host: '', plc_port: 5000, plc_device: 'X', plc_address: '4A' };

function emptyDraft(plants: HierarchyPlant[], at?: { plantId?: number; deptId?: number; lineId?: number; machineId?: number }): CameraDraft {
  return {
    plantId: at?.plantId ? String(at.plantId) : plants[0] ? String(plants[0].id) : NEW, newPlantName: '',
    deptId: at?.deptId ? String(at.deptId) : '', newDeptName: '',
    lineId: at?.lineId ? String(at.lineId) : '', newLineName: '',
    machineId: at?.machineId ? String(at.machineId) : '', newMachineName: '',
    name: '', camera_ip: '', username: 'admin', password: '',
    rtsp_port: 554, http_port: 80, channel: 1, rtsp_path: DEFAULT_MAIN_PATH, sub_rtsp_path: DEFAULT_SUB_PATH,
    mode: 'live',
    plc: { ...EMPTY_PLC },
  };
}

/* ================================================================ component */

export function HierarchyManager({ onBack }: { onBack?: () => void }) {
  const [plants, setPlants] = useState<HierarchyPlant[]>([]);
  const [target, setTarget] = useState<RecordingTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [activePlantId, setActivePlantId] = useState<number | null>(null);
  const [snapTick, setSnapTick] = useState(Date.now());
  const [busyCameraId, setBusyCameraId] = useState<number | null>(null);

  const [wizard, setWizard] = useState<CameraDraft | null>(null);
  const [entity, setEntity] = useState<EntityEdit | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [tree, rec] = await Promise.all([fetchHierarchy(), fetchRecordingTarget().catch(() => null)]);
      setPlants(tree);
      setTarget(rec);
      setActivePlantId((cur) => (cur && tree.some((p) => p.id === cur) ? cur : tree[0]?.id ?? null));
    } catch (err) {
      setNotice({ kind: 'error', text: `Could not load plants: ${message(err)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const t = window.setInterval(() => setSnapTick(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const allCameras = useMemo(() => {
    const list: { cam: HierarchyCamera; plant: HierarchyPlant; dept: HierarchyDepartment; line: HierarchyLine; machine: HierarchyMachine }[] = [];
    plants.forEach((plant) => plant.departments.forEach((dept) => dept.lines.forEach((line) => line.machines.forEach((machine) =>
      machine.cameras.forEach((cam) => list.push({ cam, plant, dept, line, machine }))))));
    return list;
  }, [plants]);

  const recordingCam = allCameras.find((c) => cameraIsRecordingTarget(c.cam, target)) || null;
  const activePlant = plants.find((p) => p.id === activePlantId) || null;
  const cameraCount = (plant: HierarchyPlant) =>
    plant.departments.reduce((n, d) => n + d.lines.reduce((m, l) => m + l.machines.reduce((k, mc) => k + mc.cameras.length, 0), 0), 0);

  async function changeMode(cam: HierarchyCamera, machine: HierarchyMachine, mode: RecordingMode) {
    if (mode === 'event' && !machine.plc_host) {
      setNotice({ kind: 'error', text: `Add the PLC IP for machine "${machine.name}" first, then switch on event recording.` });
      setEntity({ level: 'machine', item: machine, parentId: machine.line_id });
      return;
    }
    setBusyCameraId(cam.id);
    try {
      const rec = await setCameraRecordingMode(cam.id, mode);
      setTarget(rec);
      setNotice({
        kind: 'ok',
        text: mode === 'event'
          ? `"${cam.name}" will now record automatically on the PLC signal of ${machine.name}.`
          : `"${cam.name}" is now live view only.`,
      });
    } catch (err) {
      setNotice({ kind: 'error', text: message(err) });
    } finally {
      setBusyCameraId(null);
    }
  }

  async function remove(level: Level | 'camera', id: number, label: string) {
    const extra = level === 'camera' ? '' : ' Everything inside it (lines, machines, cameras) will also be removed.';
    if (!window.confirm(`Delete ${level} "${label}"?${extra}`)) return;
    try {
      if (level === 'plant') await deletePlant(id);
      if (level === 'department') await deleteDepartment(id);
      if (level === 'line') await deleteLine(id);
      if (level === 'machine') await deleteMachine(id);
      if (level === 'camera') await deleteCamera(id);
      setNotice({ kind: 'ok', text: `Deleted ${level} "${label}".` });
      await reload();
    } catch (err) {
      setNotice({ kind: 'error', text: message(err) });
    }
  }

  function openEditCamera(cam: HierarchyCamera, plant: HierarchyPlant, dept: HierarchyDepartment, line: HierarchyLine, machine: HierarchyMachine) {
    setWizard({
      ...emptyDraft(plants),
      id: cam.id,
      plantId: String(plant.id), deptId: String(dept.id), lineId: String(line.id), machineId: String(machine.id),
      name: cam.name, camera_ip: cam.camera_ip, username: cam.username || 'admin', password: '',
      rtsp_port: cam.rtsp_port || 554, http_port: cam.http_port || 80, channel: cam.channel || 1,
      rtsp_path: cam.rtsp_path || DEFAULT_MAIN_PATH, sub_rtsp_path: cam.sub_rtsp_path || DEFAULT_SUB_PATH,
      mode: cameraIsRecordingTarget(cam, target) ? 'event' : 'live',
      plc: { plc_host: machine.plc_host || '', plc_port: machine.plc_port || 5000, plc_device: machine.plc_device || 'X', plc_address: machine.plc_address || '4A' },
    });
  }

  /* ------------------------------------------------------------- render */

  return (
    <div className="hm-page">
      <header className="er-header">
        <div className="er-title">
          {onBack && (
            <button type="button" className="er-btn er-btn-secondary" onClick={onBack}><Ico name="back" /> Back</button>
          )}
          <span className="er-title-icon"><Ico name="camera" /></span>
          <div>
            <h1>Plants &amp; Cameras</h1>
            <p>Add cameras plant-wise and choose for each one: live view only, or live view + automatic recording on the machine's PLC signal.</p>
          </div>
        </div>
        <div className="er-header-actions">
          <button type="button" className="er-btn er-btn-secondary" onClick={reload} disabled={loading}>
            <Ico name="reload" /> {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className="er-btn er-btn-primary" onClick={() => setWizard(emptyDraft(plants, { plantId: activePlantId ?? undefined }))}>
            <Ico name="plus" /> Add camera
          </button>
        </div>
      </header>

      {notice && <div className={notice.kind === 'ok' ? 'hm-notice hm-notice-ok' : 'hm-notice hm-notice-error'} role="status">{notice.text}</div>}

      {/* Which camera records on PLC events */}
      <section className={recordingCam ? 'hm-rec hm-rec-on' : 'hm-rec'}>
        <span className="hm-rec-icon"><Ico name="rec" /></span>
        {recordingCam ? (
          <div>
            <strong>Event recording: {recordingCam.cam.name}</strong>
            <span>
              {recordingCam.plant.name} › {recordingCam.dept.name} › {recordingCam.line.name} › {recordingCam.machine.name}
              {' · '}PLC {target?.plc_host}:{target?.plc_port} ({target?.plc_device}{target?.plc_address})
              {' · '}{target?.monitor_running ? `monitor running, machine ${target?.machine_state || 'running'}` : 'monitor stopped'}
              {target?.recording_running ? ' · recording now' : ''}
            </span>
          </div>
        ) : (
          <div>
            <strong>No camera records on PLC events</strong>
            <span>All cameras are live view only. Switch a camera to "Live + Event recording" to record stoppages automatically. One camera can record at a time.</span>
          </div>
        )}
      </section>

      {/* Plant tabs */}
      <div className="hm-tabs" role="group" aria-label="Plants">
        {plants.map((p) => (
          <button key={p.id} type="button" className={p.id === activePlantId ? 'hm-tab is-active' : 'hm-tab'} onClick={() => setActivePlantId(p.id)}>
            {p.name} <span>{cameraCount(p)}</span>
          </button>
        ))}
        <button type="button" className="hm-tab hm-tab-add" onClick={() => setEntity({ level: 'plant', item: null, parentId: null })}>
          <Ico name="plus" /> Plant
        </button>
      </div>

      {!loading && plants.length === 0 && (
        <div className="er-table-card"><div className="er-empty">
          <strong>No plants yet</strong>
          <span>Start by adding a plant, or click “Add camera” — you can create the plant, department, line and machine in the same form.</span>
        </div></div>
      )}

      {activePlant && (
        <section className="hm-plant">
          <div className="hm-row-head hm-plant-head">
            <div>
              <h2>{activePlant.name} <small>{activePlant.code}</small></h2>
              {activePlant.location && <p>{activePlant.location}</p>}
            </div>
            <div className="hm-row-actions">
              <button type="button" className="er-btn er-btn-secondary hm-sm" onClick={() => setEntity({ level: 'department', item: null, parentId: activePlant.id })}><Ico name="plus" /> Department</button>
              <button type="button" className="er-icon-btn" title="Edit plant" onClick={() => setEntity({ level: 'plant', item: activePlant, parentId: null })}><Ico name="edit" /></button>
              <button type="button" className="er-icon-btn hm-danger" title="Delete plant" onClick={() => remove('plant', activePlant.id, activePlant.name)}><Ico name="trash" /></button>
            </div>
          </div>

          {activePlant.departments.length === 0 && <p className="hm-empty">No departments in this plant yet. Add one with “+ Department”.</p>}

          {activePlant.departments.map((dept) => (
            <div key={dept.id} className="hm-dept">
              <div className="hm-row-head">
                <h3>{dept.name} <small>{dept.code}</small></h3>
                <div className="hm-row-actions">
                  <button type="button" className="er-btn er-btn-secondary hm-sm" onClick={() => setEntity({ level: 'line', item: null, parentId: dept.id })}><Ico name="plus" /> Line</button>
                  <button type="button" className="er-icon-btn" title="Edit department" onClick={() => setEntity({ level: 'department', item: dept, parentId: activePlant.id })}><Ico name="edit" /></button>
                  <button type="button" className="er-icon-btn hm-danger" title="Delete department" onClick={() => remove('department', dept.id, dept.name)}><Ico name="trash" /></button>
                </div>
              </div>

              {dept.lines.length === 0 && <p className="hm-empty">No lines yet.</p>}

              {dept.lines.map((line) => (
                <div key={line.id} className="hm-line">
                  <div className="hm-row-head">
                    <h4>{line.name} <small>{line.code}</small></h4>
                    <div className="hm-row-actions">
                      <button type="button" className="er-btn er-btn-secondary hm-sm" onClick={() => setEntity({ level: 'machine', item: null, parentId: line.id })}><Ico name="plus" /> Machine</button>
                      <button type="button" className="er-icon-btn" title="Edit line" onClick={() => setEntity({ level: 'line', item: line, parentId: dept.id })}><Ico name="edit" /></button>
                      <button type="button" className="er-icon-btn hm-danger" title="Delete line" onClick={() => remove('line', line.id, line.name)}><Ico name="trash" /></button>
                    </div>
                  </div>

                  {line.machines.length === 0 && <p className="hm-empty">No machines on this line yet.</p>}

                  {line.machines.map((machine) => (
                    <div key={machine.id} className="hm-machine">
                      <div className="hm-row-head">
                        <div className="hm-machine-title">
                          <strong>{machine.name}</strong> <small>{machine.code}</small>
                          {machine.plc_host
                            ? <span className="hm-chip"><Ico name="plc" /> PLC {machine.plc_host}:{machine.plc_port} · {machine.plc_device}{machine.plc_address}</span>
                            : <span className="hm-chip hm-chip-warn"><Ico name="plc" /> PLC not set</span>}
                        </div>
                        <div className="hm-row-actions">
                          <button type="button" className="er-btn er-btn-secondary hm-sm"
                            onClick={() => setWizard(emptyDraft(plants, { plantId: activePlant.id, deptId: dept.id, lineId: line.id, machineId: machine.id }))}>
                            <Ico name="plus" /> Camera
                          </button>
                          <button type="button" className="er-icon-btn" title="Edit machine & PLC" onClick={() => setEntity({ level: 'machine', item: machine, parentId: line.id })}><Ico name="edit" /></button>
                          <button type="button" className="er-icon-btn hm-danger" title="Delete machine" onClick={() => remove('machine', machine.id, machine.name)}><Ico name="trash" /></button>
                        </div>
                      </div>

                      {machine.cameras.length === 0 ? (
                        <p className="hm-empty">No camera on this machine yet.</p>
                      ) : (
                        <div className="hm-cams">
                          {machine.cameras.map((cam) => {
                            const isRec = cameraIsRecordingTarget(cam, target);
                            const busy = busyCameraId === cam.id;
                            return (
                              <article key={cam.id} className={isRec ? 'hm-cam is-rec' : 'hm-cam'}>
                                <div className="hm-cam-thumb">
                                  <img src={`${hierarchyCameraSnapshotUrl(cam.id)}&k=${snapTick}`} alt={`${cam.name} preview`} loading="lazy" />
                                  <span className={isRec ? 'hm-badge hm-badge-rec' : 'hm-badge'}>{isRec ? 'REC on event' : 'LIVE'}</span>
                                </div>
                                <div className="hm-cam-body">
                                  <div className="hm-cam-name">
                                    <strong>{cam.name}</strong>
                                    <span>{cam.camera_ip}:{cam.rtsp_port} · CH {cam.channel}</span>
                                  </div>
                                  <div className="hm-mode" role="radiogroup" aria-label={`Mode for ${cam.name}`}>
                                    <button type="button" role="radio" aria-checked={!isRec} disabled={busy || !isRec}
                                      className={!isRec ? 'is-active' : undefined} onClick={() => changeMode(cam, machine, 'live')}>
                                      <Ico name="eye" /> Live only
                                    </button>
                                    <button type="button" role="radio" aria-checked={isRec} disabled={busy || isRec}
                                      className={isRec ? 'is-active is-rec' : undefined} onClick={() => changeMode(cam, machine, 'event')}>
                                      <Ico name="rec" /> Live + Event recording
                                    </button>
                                  </div>
                                  <div className="hm-cam-actions">
                                    <button type="button" className="er-btn er-btn-secondary hm-sm" onClick={() => openEditCamera(cam, activePlant, dept, line, machine)}><Ico name="edit" /> Edit</button>
                                    <button type="button" className="er-icon-btn hm-danger" title="Remove camera" onClick={() => remove('camera', cam.id, cam.name)}><Ico name="trash" /></button>
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {wizard && (
        <CameraWizard
          plants={plants}
          initial={wizard}
          recordingCamName={recordingCam?.cam.name || null}
          onClose={() => setWizard(null)}
          onSaved={async (text) => { setWizard(null); setNotice({ kind: 'ok', text }); await reload(); }}
        />
      )}

      {entity && (
        <EntityModal
          edit={entity}
          onClose={() => setEntity(null)}
          onSaved={async (text) => { setEntity(null); setNotice({ kind: 'ok', text }); await reload(); }}
        />
      )}
    </div>
  );
}

/* ====================================================== plant/dept/line/machine */

type EntityEdit = {
  level: Level;
  item: HierarchyPlant | HierarchyDepartment | HierarchyLine | HierarchyMachine | null;
  parentId: number | null;
};

function EntityModal({ edit, onClose, onSaved }: { edit: EntityEdit; onClose: () => void; onSaved: (text: string) => void }) {
  const item = edit.item as (Partial<HierarchyMachine> & Partial<HierarchyPlant>) | null;
  const [name, setName] = useState(item?.name || '');
  const [code, setCode] = useState(item?.code || '');
  const [location, setLocation] = useState(item?.location || '');
  const [plc, setPlc] = useState<PlcFields>({
    plc_host: item?.plc_host || '', plc_port: item?.plc_port || 5000, plc_device: item?.plc_device || 'X', plc_address: item?.plc_address || '4A',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const title = `${item ? 'Edit' : 'Add'} ${edit.level}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    const finalCode = code.trim() || codeFrom(name);
    try {
      const id = item?.id;
      if (edit.level === 'plant') {
        if (id) await updatePlant(id, { name, code: finalCode, location });
        else await createPlant({ name, code: finalCode, location });
      } else if (edit.level === 'department') {
        if (id) await updateDepartment(id, { name, code: finalCode });
        else await createDepartment({ plant_id: edit.parentId!, name, code: finalCode });
      } else if (edit.level === 'line') {
        if (id) await updateLine(id, { name, code: finalCode });
        else await createLine({ department_id: edit.parentId!, name, code: finalCode });
      } else {
        const machine = { name, code: finalCode, plc_enabled: Boolean(plc.plc_host.trim()), ...plc, plc_host: plc.plc_host.trim() };
        if (id) await updateMachine(id, machine);
        else await createMachine({ line_id: edit.parentId!, ...machine });
      }
      onSaved(`${item ? 'Updated' : 'Added'} ${edit.level} "${name}".`);
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hm-overlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="hm-modal hm-modal-sm" onSubmit={save}>
        <header className="hm-modal-head">
          <h3>{title[0].toUpperCase() + title.slice(1)}</h3>
          <button type="button" className="er-icon-btn" onClick={onClose} aria-label="Close"><Ico name="close" /></button>
        </header>
        <div className="hm-modal-body">
          <div className="hm-grid-2">
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={edit.level === 'machine' ? 'e.g. UBE 850 T - 03' : ''} /></Field>
            <Field label="Code" hint="Leave blank to generate"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder={name ? codeFrom(name) : ''} /></Field>
            {edit.level === 'plant' && <Field label="Location" wide><input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>}
          </div>
          {edit.level === 'machine' && <PlcEditor plc={plc} onChange={setPlc} />}
          {error && <div className="hm-notice hm-notice-error">{error}</div>}
        </div>
        <footer className="hm-modal-foot">
          <button type="button" className="er-btn er-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="er-btn er-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </footer>
      </form>
    </div>
  );
}

/* ================================================================ wizard */

function CameraWizard({ plants, initial, recordingCamName, onClose, onSaved }: {
  plants: HierarchyPlant[];
  initial: CameraDraft;
  recordingCamName: string | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const editing = Boolean(initial.id);
  const [d, setD] = useState<CameraDraft>(initial);
  const [step, setStep] = useState(editing ? 2 : 1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [plcTest, setPlcTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<CameraDraft>) => setD((cur) => ({ ...cur, ...patch }));

  const plant = plants.find((p) => String(p.id) === d.plantId);
  const depts = plant?.departments || [];
  const dept = depts.find((x) => String(x.id) === d.deptId);
  const lines = dept?.lines || [];
  const line = lines.find((x) => String(x.id) === d.lineId);
  const machines = line?.machines || [];
  const machine = machines.find((x) => String(x.id) === d.machineId);

  // keep the cascade valid and pre-fill PLC from the chosen machine
  useEffect(() => {
    if (d.plantId !== NEW && !plant && plants[0]) set({ plantId: String(plants[0].id) });
  }, [d.plantId, plant, plants]);
  // Each level only picks a default once its parent is resolved; otherwise it would see an empty
  // list for a moment and wrongly switch to "+ New".
  useEffect(() => {
    if (d.plantId === NEW) { if (d.deptId !== NEW) set({ deptId: NEW }); return; }
    if (!plant) return;
    if (!dept && d.deptId !== NEW) set({ deptId: depts[0] ? String(depts[0].id) : NEW });
  }, [d.plantId, d.deptId, plant, dept, depts]);
  useEffect(() => {
    if (d.deptId === NEW) { if (d.lineId !== NEW) set({ lineId: NEW }); return; }
    if (!dept) return;
    if (!line && d.lineId !== NEW) set({ lineId: lines[0] ? String(lines[0].id) : NEW });
  }, [d.deptId, d.lineId, dept, line, lines]);
  useEffect(() => {
    if (d.lineId === NEW) { if (d.machineId !== NEW) set({ machineId: NEW }); return; }
    if (!line) return;
    if (!machine && d.machineId !== NEW) set({ machineId: machines[0] ? String(machines[0].id) : NEW });
  }, [d.lineId, d.machineId, line, machine, machines]);
  useEffect(() => {
    if (machine && !editing) {
      set({ plc: { plc_host: machine.plc_host || '', plc_port: machine.plc_port || 5000, plc_device: machine.plc_device || 'X', plc_address: machine.plc_address || '4A' } });
    }
  }, [machine?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const where = [
    d.plantId === NEW ? d.newPlantName : plant?.name,
    d.deptId === NEW ? d.newDeptName : dept?.name,
    d.lineId === NEW ? d.newLineName : line?.name,
    d.machineId === NEW ? d.newMachineName : machine?.name,
  ];

  function stepError(n: number): string {
    if (n === 1) {
      if (d.plantId === NEW && !d.newPlantName.trim()) return 'Enter the new plant name.';
      if (d.deptId === NEW && !d.newDeptName.trim()) return 'Enter the new department name.';
      if (d.lineId === NEW && !d.newLineName.trim()) return 'Enter the new line name.';
      if (d.machineId === NEW && !d.newMachineName.trim()) return 'Enter the new machine name.';
    }
    if (n === 2) {
      if (!d.name.trim()) return 'Give the camera a name, e.g. “Die Area Camera”.';
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(d.camera_ip.trim())) return 'Enter a valid camera IP address, e.g. 192.168.119.205.';
      if (!editing && !d.password) return 'Enter the camera password.';
    }
    if (n === 3 && d.mode === 'event' && !d.plc.plc_host.trim()) return 'Event recording needs the machine PLC IP.';
    return '';
  }

  function next() {
    const err = stepError(step);
    setError(err);
    if (!err) setStep(step + 1);
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await testCameraConnection({
        camera_ip: d.camera_ip.trim(), http_port: d.http_port, rtsp_port: d.rtsp_port, username: d.username,
        password: d.password, channel: d.channel, rtsp_path: d.rtsp_path, camera_id: d.id,
      });
      setTest({ ok: r.rtsp_stream_ok, text: r.message });
    } catch (err) {
      setTest({ ok: false, text: message(err) });
    } finally {
      setTesting(false);
    }
  }

  async function runPlcTest() {
    setPlcTest(null);
    try {
      const r = await testPlcConnection({ ...d.plc, plc_host: d.plc.plc_host.trim() });
      setPlcTest({ ok: r.ok, text: r.message });
    } catch (err) {
      setPlcTest({ ok: false, text: message(err) });
    }
  }

  async function save() {
    for (const n of [1, 2, 3]) {
      const err = stepError(n);
      if (err) { setError(err); setStep(n); return; }
    }
    setSaving(true);
    setError('');
    try {
      let plantId = Number(d.plantId);
      if (d.plantId === NEW) plantId = (await createPlant({ name: d.newPlantName.trim(), code: codeFrom(d.newPlantName) })).id;
      let deptId = Number(d.deptId);
      if (d.deptId === NEW) deptId = (await createDepartment({ plant_id: plantId, name: d.newDeptName.trim(), code: codeFrom(d.newDeptName) })).id;
      let lineId = Number(d.lineId);
      if (d.lineId === NEW) lineId = (await createLine({ department_id: deptId, name: d.newLineName.trim(), code: codeFrom(d.newLineName) })).id;

      const plc = { ...d.plc, plc_host: d.plc.plc_host.trim() };
      let machineId = Number(d.machineId);
      if (d.machineId === NEW) {
        machineId = (await createMachine({ line_id: lineId, name: d.newMachineName.trim(), code: codeFrom(d.newMachineName), plc_enabled: Boolean(plc.plc_host), ...plc })).id;
      } else if (d.mode === 'event' && machine && (machine.plc_host !== plc.plc_host || machine.plc_port !== plc.plc_port
        || machine.plc_device !== plc.plc_device || machine.plc_address !== plc.plc_address)) {
        await updateMachine(machineId, { plc_enabled: true, ...plc });
      }

      const camera = {
        machine_id: machineId, name: d.name.trim(), camera_ip: d.camera_ip.trim(), username: d.username.trim(),
        rtsp_port: d.rtsp_port, http_port: d.http_port, channel: d.channel, rtsp_path: d.rtsp_path, sub_rtsp_path: d.sub_rtsp_path,
        is_active: true,
      };
      let cameraId = d.id;
      if (cameraId) await updateCamera(cameraId, { ...camera, ...(d.password ? { password: d.password } : {}) });
      else cameraId = (await createCamera({ ...camera, password: d.password })).id;

      const wasRecording = initial.mode === 'event';
      if (d.mode === 'event' || wasRecording) {
        await setCameraRecordingMode(cameraId!, d.mode);
      }
      onSaved(d.mode === 'event'
        ? `Saved "${d.name}". It records automatically on the PLC signal.`
        : `Saved "${d.name}" as live view only.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  const steps = ['Location', 'Camera', 'Mode'];

  return (
    <div className="hm-overlay" role="dialog" aria-modal="true" aria-label={editing ? 'Edit camera' : 'Add camera'} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hm-modal">
        <header className="hm-modal-head">
          <h3>{editing ? `Edit camera: ${initial.name}` : 'Add camera'}</h3>
          <button type="button" className="er-icon-btn" onClick={onClose} aria-label="Close"><Ico name="close" /></button>
        </header>

        <ol className="hm-steps">
          {steps.map((s, i) => (
            <li key={s} className={step === i + 1 ? 'is-current' : step > i + 1 ? 'is-done' : undefined}>
              <button type="button" onClick={() => { if (i + 1 < step || !stepError(step)) setStep(i + 1); }}>
                <span>{i + 1}</span> {s}
              </button>
            </li>
          ))}
        </ol>

        <div className="hm-modal-body">
          {step === 1 && (
            <>
              <p className="hm-help">Where is this camera installed? Pick existing items or choose “+ New …” to create them here.</p>
              <div className="hm-grid-2">
                <Pick label="Plant" value={d.plantId} options={plants} newLabel="+ New plant" onChange={(v) => set({ plantId: v })}
                  newValue={d.newPlantName} onNew={(v) => set({ newPlantName: v })} newPlaceholder="e.g. Rico Gurgaon" />
                <Pick label="Department" value={d.deptId} options={depts} newLabel="+ New department" onChange={(v) => set({ deptId: v })}
                  newValue={d.newDeptName} onNew={(v) => set({ newDeptName: v })} newPlaceholder="e.g. HPDC Casting" />
                <Pick label="Line" value={d.lineId} options={lines} newLabel="+ New line" onChange={(v) => set({ lineId: v })}
                  newValue={d.newLineName} onNew={(v) => set({ newLineName: v })} newPlaceholder="e.g. Die Casting Line 01" />
                <Pick label="Machine" value={d.machineId} options={machines} newLabel="+ New machine" onChange={(v) => set({ machineId: v })}
                  newValue={d.newMachineName} onNew={(v) => set({ newMachineName: v })} newPlaceholder="e.g. UBE 850 T - 03" />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="hm-help">Installed at: <strong>{where.filter(Boolean).join(' › ')}</strong></p>
              <div className="hm-grid-2">
                <Field label="Camera name"><input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Die Area Camera" autoFocus /></Field>
                <Field label="Camera IP address"><input value={d.camera_ip} onChange={(e) => set({ camera_ip: e.target.value })} placeholder="e.g. 192.168.119.205" inputMode="decimal" /></Field>
                <Field label="Username"><input value={d.username} onChange={(e) => set({ username: e.target.value })} /></Field>
                <Field label="Password" hint={editing ? 'Leave blank to keep the current password' : undefined}>
                  <input type="password" value={d.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" placeholder={editing ? '••••••••' : ''} />
                </Field>
              </div>
              <button type="button" className="hm-link" onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? 'Hide' : 'Show'} advanced stream settings (ports, channel, RTSP paths)
              </button>
              {showAdvanced && (
                <div className="hm-grid-3">
                  <Field label="RTSP port"><input type="number" value={d.rtsp_port} onChange={(e) => set({ rtsp_port: Number(e.target.value) || 554 })} /></Field>
                  <Field label="HTTP port"><input type="number" value={d.http_port} onChange={(e) => set({ http_port: Number(e.target.value) || 80 })} /></Field>
                  <Field label="Channel"><input type="number" min={1} value={d.channel} onChange={(e) => set({ channel: Number(e.target.value) || 1 })} /></Field>
                  <Field label="Main stream path (recording)" wide><input value={d.rtsp_path} onChange={(e) => set({ rtsp_path: e.target.value })} /></Field>
                  <Field label="Sub stream path (live preview)" wide><input value={d.sub_rtsp_path} onChange={(e) => set({ sub_rtsp_path: e.target.value })} /></Field>
                </div>
              )}
              <div className="hm-test-row">
                <button type="button" className="er-btn er-btn-secondary" onClick={runTest} disabled={testing || !d.camera_ip.trim()}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                {test && <span className={test.ok ? 'hm-test-ok' : 'hm-test-fail'}>{test.ok ? '✓ ' : '✕ '}{test.text}</span>}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="hm-help">How should this camera work?</p>
              <div className="hm-mode-cards" role="radiogroup">
                <label className={d.mode === 'live' ? 'hm-mode-card is-active' : 'hm-mode-card'}>
                  <input type="radio" name="mode" checked={d.mode === 'live'} onChange={() => set({ mode: 'live' })} />
                  <span className="hm-mode-icon"><Ico name="eye" /></span>
                  <span><strong>Live view only</strong><small>Watch live video and audio. Nothing is recorded.</small></span>
                </label>
                <label className={d.mode === 'event' ? 'hm-mode-card is-active is-rec' : 'hm-mode-card'}>
                  <input type="radio" name="mode" checked={d.mode === 'event'} onChange={() => set({ mode: 'event' })} />
                  <span className="hm-mode-icon"><Ico name="rec" /></span>
                  <span>
                    <strong>Live + Event recording</strong>
                    <small>Records automatically when the machine's PLC signal shows a stoppage, and saves it in the Event Report.</small>
                  </span>
                </label>
              </div>
              {d.mode === 'event' && (
                <>
                  {recordingCamName && recordingCamName !== initial.name && (
                    <div className="hm-notice hm-notice-warn">
                      Only one camera can record at a time. Saving moves event recording from “{recordingCamName}” to this camera.
                    </div>
                  )}
                  <PlcEditor plc={d.plc} onChange={(plc) => set({ plc })} />
                  <div className="hm-test-row">
                    <button type="button" className="er-btn er-btn-secondary" onClick={runPlcTest} disabled={!d.plc.plc_host.trim()}>Test PLC</button>
                    {plcTest && <span className={plcTest.ok ? 'hm-test-ok' : 'hm-test-fail'}>{plcTest.ok ? '✓ ' : '✕ '}{plcTest.text}</span>}
                  </div>
                </>
              )}
            </>
          )}

          {error && <div className="hm-notice hm-notice-error">{error}</div>}
        </div>

        <footer className="hm-modal-foot">
          {step > 1 ? <button type="button" className="er-btn er-btn-secondary" onClick={() => { setError(''); setStep(step - 1); }}>Back</button> : <span />}
          {step < 3
            ? <button type="button" className="er-btn er-btn-primary" onClick={next}>Next</button>
            : <button type="button" className="er-btn er-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add camera'}</button>}
        </footer>
      </div>
    </div>
  );
}

/* ================================================================ small parts */

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? 'hm-field hm-wide' : 'hm-field'}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Pick({ label, value, options, newLabel, onChange, newValue, onNew, newPlaceholder }: {
  label: string; value: string; options: { id: number; name: string }[]; newLabel: string;
  onChange: (v: string) => void; newValue: string; onNew: (v: string) => void; newPlaceholder: string;
}) {
  return (
    <div className="hm-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
        <option value={NEW}>{newLabel}</option>
      </select>
      {value === NEW && <input value={newValue} onChange={(e) => onNew(e.target.value)} placeholder={newPlaceholder} aria-label={`New ${label.toLowerCase()} name`} />}
    </div>
  );
}

function PlcEditor({ plc, onChange }: { plc: PlcFields; onChange: (p: PlcFields) => void }) {
  return (
    <fieldset className="hm-plc">
      <legend>Machine PLC (stoppage signal)</legend>
      <div className="hm-grid-4">
        <Field label="PLC IP"><input value={plc.plc_host} onChange={(e) => onChange({ ...plc, plc_host: e.target.value })} placeholder="e.g. 192.168.117.201" /></Field>
        <Field label="Port"><input type="number" value={plc.plc_port} onChange={(e) => onChange({ ...plc, plc_port: Number(e.target.value) || 5000 })} /></Field>
        <Field label="Device"><input value={plc.plc_device} onChange={(e) => onChange({ ...plc, plc_device: e.target.value.toUpperCase() })} /></Field>
        <Field label="Address"><input value={plc.plc_address} onChange={(e) => onChange({ ...plc, plc_address: e.target.value.toUpperCase() })} /></Field>
      </div>
    </fieldset>
  );
}
