with open(r'c:\Vikram Dubey One Drive\OneDrive - ricoauto.in\Desktop\Project\AB\Camera-WebApp\camera_app\frontend\src\App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the BODY section start and the footer buttons (end marker)
body_start = "          {/* ── BODY ── */}"
body_end = "            {/* ─ FOOTER BUTTONS ─ */}"

idx_start = content.find(body_start)
idx_end = content.find(body_end, idx_start)

if idx_start == -1:
    print("BODY START NOT FOUND")
    exit()
if idx_end == -1:
    print("BODY END NOT FOUND")
    exit()

new_body = """          {/* ── BODY ── */}
          <div style={{ flex: 1, padding: '32px 48px 64px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1300px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

            {/* ─ AI CONTEXT SECTION ─ */}
            <div style={{ border: '1px solid rgba(59,130,246,0.2)', borderRadius: '14px', overflow: 'hidden', background: 'rgba(59,130,246,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: '800', letterSpacing: '2px', textTransform: 'uppercase', color: '#3b82f6', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '5px', padding: '3px 8px' }}>AI</span>
                  <span style={{ fontSize: '1rem', fontWeight: '600', color: '#e2e8f0' }}>Event Context & AI Transcript</span>
                </div>
              </div>
              <div style={{ padding: '0 24px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px' }}>AI Voice Transcript</span>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '14px', borderRadius: '8px', color: editingReasonRecord?.transcript ? '#cbd5e1' : '#374151', fontStyle: editingReasonRecord?.transcript ? 'normal' : 'italic', fontSize: '0.95rem', border: '1px solid rgba(255,255,255,0.05)', lineHeight: '1.6', minHeight: '80px' }}>
                    {editingReasonRecord?.transcript || 'No speech detected during this event.'}
                  </div>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Manual Correction (if AI is wrong)</span>
                  <textarea disabled={savingReason || isViewMode} placeholder="Type corrected transcript here..."
                    value={editManualTranscript} onChange={e => setEditManualTranscript(e.target.value)}
                    style={{ flex: 1, minHeight: '80px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', color: 'white', padding: '14px', fontSize: '0.95rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: '1.6', transition: 'border-color 0.2s', fontFamily: 'inherit' }}
                    onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; }}
                    onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.07)'; }}
                  />
                </label>
              </div>
            </div>

            {/* ─ STEP 1: DOWNTIME TYPE ACCORDION ─ */}
            <AccordionSection
              step="1"
              title="Downtime Type"
              color="#10b981"
              selected={editReasonText}
              isOpen={openStep === 1}
              onToggle={() => setOpenStep(openStep === 1 ? 0 : 1)}
              disabled={savingReason || isViewMode}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {DOWNTIME_TYPES.map(opt => (
                  <button key={opt} type="button" disabled={savingReason || isViewMode}
                    onClick={() => {
                      setEditReasonText(opt);
                      setSelectedCategory('');
                      setSelectedSubReason('');
                      setOpenStep(2);
                    }}
                    style={{ padding: '12px 22px', borderRadius: '10px', border: editReasonText === opt ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.09)', background: editReasonText === opt ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.04)', color: editReasonText === opt ? '#34d399' : '#94a3b8', cursor: (savingReason || isViewMode) ? 'not-allowed' : 'pointer', fontSize: '0.95rem', fontWeight: editReasonText === opt ? '700' : '500', transition: 'all 0.18s', boxShadow: editReasonText === opt ? '0 0 0 3px rgba(16,185,129,0.15)' : 'none' }}
                    onMouseOver={(e) => { if (editReasonText !== opt) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#e2e8f0'; } }}
                    onMouseOut={(e) => { if (editReasonText !== opt) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#94a3b8'; } }}
                  >{opt}</button>
                ))}
              </div>
            </AccordionSection>

            {/* ─ STEP 2: CATEGORY ACCORDION ─ */}
            {editReasonText && DOWNTIME_TYPES.includes(editReasonText) && (
              <AccordionSection
                step="2"
                title="Category"
                color="#10b981"
                selected={selectedCategory}
                isOpen={openStep === 2}
                onToggle={() => setOpenStep(openStep === 2 ? 0 : 2)}
                disabled={savingReason || isViewMode}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {Object.keys(ACTUAL_DOWNTIME_DATA[editReasonText] || {}).map(opt => (
                    <button key={opt} type="button" disabled={savingReason || isViewMode}
                      onClick={() => {
                        setSelectedCategory(opt);
                        setSelectedSubReason(opt === 'No Reason' ? 'No Reason' : '');
                        setOpenStep((ACTUAL_DOWNTIME_DATA[editReasonText]?.[opt] || []).length > 0 && opt !== 'No Reason' ? 3 : 4);
                      }}
                      style={{ padding: '12px 22px', borderRadius: '10px', border: selectedCategory === opt ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.09)', background: selectedCategory === opt ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.04)', color: selectedCategory === opt ? '#34d399' : '#94a3b8', cursor: (savingReason || isViewMode) ? 'not-allowed' : 'pointer', fontSize: '0.95rem', fontWeight: selectedCategory === opt ? '700' : '500', transition: 'all 0.18s', boxShadow: selectedCategory === opt ? '0 0 0 3px rgba(16,185,129,0.15)' : 'none' }}
                      onMouseOver={(e) => { if (selectedCategory !== opt) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#e2e8f0'; } }}
                      onMouseOut={(e) => { if (selectedCategory !== opt) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#94a3b8'; } }}
                    >{opt}</button>
                  ))}
                </div>
              </AccordionSection>
            )}

            {/* ─ STEP 3: SUB-REASON ACCORDION ─ */}
            {editReasonText && selectedCategory && selectedCategory !== 'No Reason' && (ACTUAL_DOWNTIME_DATA[editReasonText]?.[selectedCategory] || []).length > 0 && (
              <AccordionSection
                step="3"
                title="Sub-Reason"
                color="#10b981"
                selected={selectedSubReason}
                isOpen={openStep === 3}
                onToggle={() => setOpenStep(openStep === 3 ? 0 : 3)}
                disabled={savingReason || isViewMode}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {(ACTUAL_DOWNTIME_DATA[editReasonText]?.[selectedCategory] || []).map((opt: string) => (
                    <button key={opt} type="button" disabled={savingReason || isViewMode}
                      onClick={() => { setSelectedSubReason(opt); setOpenStep(4); }}
                      style={{ padding: '12px 22px', borderRadius: '10px', border: selectedSubReason === opt ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.09)', background: selectedSubReason === opt ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.04)', color: selectedSubReason === opt ? '#34d399' : '#94a3b8', cursor: (savingReason || isViewMode) ? 'not-allowed' : 'pointer', fontSize: '0.95rem', fontWeight: selectedSubReason === opt ? '700' : '500', transition: 'all 0.18s', boxShadow: selectedSubReason === opt ? '0 0 0 3px rgba(16,185,129,0.15)' : 'none' }}
                      onMouseOver={(e) => { if (selectedSubReason !== opt) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#e2e8f0'; } }}
                      onMouseOut={(e) => { if (selectedSubReason !== opt) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#94a3b8'; } }}
                    >{opt}</button>
                  ))}
                </div>
              </AccordionSection>
            )}

            {/* ─ STEP 4: DEPARTMENT ACCORDION ─ */}
            {editReasonText && selectedCategory && (
              <AccordionSection
                step="4"
                title="Responsible Department"
                color="#3b82f6"
                selected={editResponsibility}
                isOpen={openStep === 4}
                onToggle={() => setOpenStep(openStep === 4 ? 0 : 4)}
                disabled={savingReason || isViewMode}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {["M/c Maintenance", "Die-Maintenance", "Quality", "Production"].map(opt => (
                    <button key={opt} type="button" disabled={savingReason || isViewMode}
                      onClick={() => {
                        setEditResponsibility(opt);
                        if (opt === 'M/c Maintenance') setEditPerson('Ashutosh Pandey');
                        else if (opt === 'Die-Maintenance') setEditPerson('S.A. Yadav');
                        else if (opt === 'Quality') setEditPerson('Sanjay Kaul');
                        else if (opt === 'Production') setEditPerson('Samsher Singh');
                        else setEditPerson('');
                        setOpenStep(5);
                      }}
                      style={{ padding: '12px 22px', borderRadius: '10px', border: editResponsibility === opt ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.09)', background: editResponsibility === opt ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)', color: editResponsibility === opt ? '#93c5fd' : '#94a3b8', cursor: (savingReason || isViewMode) ? 'not-allowed' : 'pointer', fontSize: '0.95rem', fontWeight: editResponsibility === opt ? '700' : '500', transition: 'all 0.18s', boxShadow: editResponsibility === opt ? '0 0 0 3px rgba(59,130,246,0.15)' : 'none' }}
                      onMouseOver={(e) => { if (editResponsibility !== opt) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#e2e8f0'; } }}
                      onMouseOut={(e) => { if (editResponsibility !== opt) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#94a3b8'; } }}
                    >{opt}</button>
                  ))}
                </div>
              </AccordionSection>
            )}

            {/* ─ STEP 5: DETAILS ─ */}
            {editResponsibility && (
              <div style={{ border: '1px solid rgba(59,130,246,0.2)', borderRadius: '14px', overflow: 'hidden', background: 'rgba(59,130,246,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: '800', letterSpacing: '2px', textTransform: 'uppercase', color: '#3b82f6', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '5px', padding: '3px 8px' }}>5</span>
                  <span style={{ fontSize: '1rem', fontWeight: '600', color: '#e2e8f0' }}>Additional Details</span>
                </div>
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px' }}>HOD / Person Name</span>
                      <input type="text" disabled={savingReason || isViewMode} placeholder="e.g. Ashutosh Pandey" value={editPerson} onChange={e => setEditPerson(e.target.value)}
                        style={{ height: '46px', padding: '0 14px', fontSize: '0.95rem', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'white', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s', fontFamily: 'inherit' }}
                        onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; }}
                        onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.09)'; }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Status</span>
                      <div style={{ display: 'flex', gap: '8px', height: '46px' }}>
                        {["Pending", "Completed"].map(opt => (
                          <button key={opt} type="button" disabled={savingReason || isViewMode}
                            onClick={() => setEditStatus(opt)}
                            style={{ flex: 1, borderRadius: '8px', border: editStatus === opt ? '2px solid ' + (opt === 'Completed' ? '#10b981' : '#f59e0b') : '1px solid rgba(255,255,255,0.09)', background: editStatus === opt ? (opt === 'Completed' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)') : 'rgba(255,255,255,0.04)', color: editStatus === opt ? (opt === 'Completed' ? '#34d399' : '#fbbf24') : '#94a3b8', cursor: (savingReason || isViewMode) ? 'not-allowed' : 'pointer', fontSize: '0.88rem', fontWeight: editStatus === opt ? '700' : '500', transition: 'all 0.18s' }}
                          >{opt}</button>
                        ))}
                      </div>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Target Date</span>
                      <input type="date" disabled={savingReason || isViewMode} value={editTargetDate} onChange={e => setEditTargetDate(e.target.value)}
                        style={{ height: '46px', padding: '0 14px', fontSize: '0.95rem', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'white', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark', transition: 'border-color 0.2s' }}
                        onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; }}
                        onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.09)'; }}
                      />
                    </label>
                  </div>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }}></span>
                      Action Taken
                    </span>
                    <textarea disabled={savingReason || isViewMode}
                      placeholder="Describe the corrective action taken to resolve this downtime issue..."
                      value={editNoteText} onChange={e => setEditNoteText(e.target.value)}
                      style={{ minHeight: '100px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', color: 'white', padding: '14px', fontSize: '0.95rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: '1.6', transition: 'border-color 0.2s', fontFamily: 'inherit' }}
                      onFocus={(e) => { e.target.style.borderColor = '#f59e0b'; }}
                      onBlur={(e) => { e.target.style.borderColor = 'rgba(245,158,11,0.2)'; }}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* ─ FOOTER BUTTONS ─ */}"""

# Replace
content = content[:idx_start] + new_body + content[idx_end + len("            {/* ─ FOOTER BUTTONS ─ */}"):]

with open(r'c:\Vikram Dubey One Drive\OneDrive - ricoauto.in\Desktop\Project\AB\Camera-WebApp\camera_app\frontend\src\App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS")
