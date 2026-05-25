import { useState, useEffect, useRef } from 'react'
import ShippingLabelModal from './ShippingLabelModal'
import './RunList.css'

const ROWS = ['A','B','C','D','E','F','G','H']
const COLS = Array.from({ length: 12 }, (_, i) => i + 1)
// Okabe-Ito + Paul Tol — color-blind safe palettes
const ORDER_PALETTE = ['#0072B2','#D55E00','#009E73','#CC79A7','#56B4E9','#E69F00','#882255','#44AA99','#DDCC77']
const CPG_PALETTE   = ['#E69F00','#56B4E9','#009E73','#0072B2','#D55E00','#CC79A7','#44AA99','#882255','#DDCC77']

const REAGENTS = [
  { key: 'wash',       label: 'Wash',       amidite: false },
  { key: 'oxidizer',   label: 'Oxidizer',   amidite: false },
  { key: 'cap_a',      label: 'Cap A',      amidite: false },
  { key: 'cap_b',      label: 'Cap B',      amidite: false },
  { key: 'activator',  label: 'Activator',  amidite: false },
  { key: 'amidite_a',  label: 'Amidite A',  amidite: true  },
  { key: 'amidite_c',  label: 'Amidite C',  amidite: true  },
  { key: 'amidite_g',  label: 'Amidite G',  amidite: true  },
  { key: 'amidite_t',  label: 'Amidite T',  amidite: true  },
]
const REAGENT_CANONICAL = {
  wash: 'wash', oxidizer: 'oxidizer', cap_a: 'cap_a', cap_b: 'cap_b', activator: 'activator',
  amidite_a: 'dA', amidite_c: 'dC', amidite_g: 'dG', amidite_t: 'dT',
}
const EMPTY_R = { material_lot_id: null, lot_number: '', solvent_lot: '', date_replaced: '', replaced_by: '' }
const STATUS_OPTS   = ['pending', 'synthesized', 'failed']
const PURIF_METHODS = ['desalting', 'RP-HPLC', 'IEX-HPLC', 'electrophoresis']
const STAGES = [['crude','Crude QC'], ['purif','Purification'], ['qc','MS / CE']]

function emptyResult() {
  return {
    status: 'pending', result_notes: '',
    crude_od_260: '', crude_a260_a280: '', crude_conc_ng_ul: '', crude_vol_ul: '',
    purif_method: '', purif_date: '', purif_operator: '', purif_notes: '',
    purif_od_260: '', purif_a260_a280: '', purif_conc_ng_ul: '', purif_vol_ul: '',
    ms_done: false, ms_pass: null, ms_notes: '',
    ce_done: false, ce_pass: null, ce_notes: '',
  }
}
function seedResult(l) {
  const n = v => v != null ? String(v) : ''
  return {
    status:           l.status          || 'pending',
    result_notes:     l.result_notes    || '',
    crude_od_260:     n(l.crude_od_260),
    crude_a260_a280:  n(l.crude_a260_a280),
    crude_conc_ng_ul: n(l.crude_conc_ng_ul),
    crude_vol_ul:     n(l.crude_vol_ul),
    purif_method:     l.purif_method    || '',
    purif_date:       l.purif_date      || '',
    purif_operator:   l.purif_operator  || '',
    purif_notes:      l.purif_notes     || '',
    purif_od_260:     n(l.purif_od_260),
    purif_a260_a280:  n(l.purif_a260_a280),
    purif_conc_ng_ul: n(l.purif_conc_ng_ul),
    purif_vol_ul:     n(l.purif_vol_ul),
    ms_done:  l.ms_done  ?? false,
    ms_pass:  l.ms_pass  ?? null,
    ms_notes: l.ms_notes || '',
    ce_done:  l.ce_done  ?? false,
    ce_pass:  l.ce_pass  ?? null,
    ce_notes: l.ce_notes || '',
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function colMajorSort(lines) {
  return [...lines].sort((a, b) => {
    const colA = parseInt(a.plate_position.slice(1)), rowA = a.plate_position[0]
    const colB = parseInt(b.plate_position.slice(1)), rowB = b.plate_position[0]
    return colA !== colB ? colA - colB : rowA.localeCompare(rowB)
  })
}

function parseNotes(notes) {
  const purification = (notes || '').match(/Purification:\s*([^,]+)/i)?.[1]?.trim() || 'Desalted'
  const formulation  = (notes || '').match(/Formulation:\s*([^,]+)/i)?.[1]?.trim() || 'Dry'
  return { purification, formulation }
}

// Replace /5Name/ /iName/ /3Name/ with assigned synth slot number.
// Mirrors applyModPositions in SynthesisRunBuilder: tries canonical_name AND all aliases.
function applyModMap(seq, modMap) {
  let result = seq
  for (const mm of (modMap || [])) {
    if (mm.synth_slot == null) continue
    const names = [
      mm.canonical_name,
      ...(mm.aliases ? String(mm.aliases).split(',').map(a => a.trim()).filter(Boolean) : []),
    ]
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(`\\/[5i3]?${escaped}\\/`, 'g'), String(mm.synth_slot))
    }
  }
  return result
}

function buildCsv(lines, modMap = []) {
  const header = "Sequence 5' - 3',DMT ON or DMT OFF,Name,Secondary Name,Purification,Formulation,Order#,Contact,Institute,,,nt"
  const esc = v => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s }
  const wellMap = {}
  for (const l of lines) wellMap[l.plate_position] = l
  // All 96 positions in column-major order
  const positions = Array.from({ length: 12 }, (_, i) => i + 1)
    .flatMap(c => ['A','B','C','D','E','F','G','H'].map(r => `${r}${c}`))
  const rows = positions.map((pos, idx) => {
    const l = wellMap[pos]
    if (!l) return `,DMT OFF,,${idx + 1}-${pos},,,,,,,,`
    const { purification, formulation } = parseNotes(l.notes)
    const rawSeq = (l.annotated_sequence || '').replace(/\s/g, '')
    // Prefer the server-computed substituted sequence; fall back to live substitution
    // for runs created before migrate_017 (synth_sequence will be null).
    const seq = l.synth_sequence || applyModMap(rawSeq, modMap)
    const nt  = l.length_nt ?? (rawSeq.replace(/[^A-Za-z]/g, '').length || '')
    return [esc(seq), l.dmt || 'DMT OFF', esc(l.oligo_name), esc(`${idx + 1}-${pos}`),
            esc(purification), esc(formulation), esc(l.order_ref), esc(l.customer_name || ''),
            esc(l.institute || ''), '', '', String(nt)].join(',')
  })
  return [header, ...rows].join('\n')
}

function buildNameFile(lines) {
  // NanoDrop sample name file — one name per measurement in column-major order
  const sorted = colMajorSort(lines)
  return 'Sample Name\n' + sorted.map(l => `"${l.plate_position} ${l.oligo_name}"`).join('\n')
}

function triggerDownload(content, filename, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 150)
}

// Parse nanodrop CSV export — extracts A260, A260/A280, concentration
function parseNanodropCsv(text) {
  const normH = s => s.toLowerCase().replace(/[\s()/.μ]/g, '')
  const parseRow = line => {
    const cols = []; let cur = ''; let inQ = false
    for (const c of line) {
      if (c === '"') { inQ = !inQ }
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
      else { cur += c }
    }
    cols.push(cur.trim())
    return cols
  }

  const lines = text.split(/\r?\n/)
  let hdrIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Location') && lines[i].includes('A260')) { hdrIdx = i; break }
  }
  if (hdrIdx === -1) return { error: 'Could not find header row with Location and A260 columns' }

  const headers  = parseRow(lines[hdrIdx])
  const nh       = headers.map(normH)
  const locIdx   = nh.findIndex(h => h === 'location')
  const a260Idx  = nh.findIndex(h => h === 'a260' || h === '260nm')
  const ratioIdx = nh.findIndex(h => (h.includes('260') && h.includes('280')))
  const concIdx  = nh.findIndex(h => h.includes('nucleicacid') || (h.includes('ng') && (h.includes('ul') || h.includes('l'))))
  const nameIdx  = nh.findIndex(h => h === 'samplename')

  const results = []
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cols  = parseRow(lines[i])
    const loc   = cols[locIdx]?.trim()
    const a260  = parseFloat(cols[a260Idx])
    const ratio = ratioIdx >= 0 ? parseFloat(cols[ratioIdx]) : NaN
    const conc  = concIdx  >= 0 ? parseFloat(cols[concIdx])  : NaN
    if (loc && !isNaN(a260)) results.push({
      loc, a260,
      ratio: isNaN(ratio) ? null : ratio,
      conc:  isNaN(conc)  ? null : conc,
      name:  nameIdx >= 0 ? (cols[nameIdx]?.trim() || '') : '',
    })
  }
  return { results }
}

// ── RunDetail ─────────────────────────────────────────────────────────────────
function RunDetail({ api, runId, onBack }) {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState('')

  // reagents — locked after first save
  const [rForm, setRForm]         = useState({})
  const [cpgForm, setCpgForm]     = useState({})
  const [fillAll, setFillAll]     = useState('')
  const [carryover, setCarryover] = useState(null)
  const [rLocked, setRLocked]     = useState(false)
  const [rLoading, setRLoading]   = useState(true)
  const [materialLots, setMaterialLots] = useState([])
  const [modLotIds, setModLotIds]       = useState({})
  const [saving, setSaving]       = useState(false)
  const [saveMsg, setSaveMsg]     = useState('')
  const [conjForm, setConjForm]   = useState({})  // canonical_name → { reagent_lot, date_conjugated, operator, notes }

  // results
  const [results, setResults]               = useState({})
  const [resStage, setResStage]             = useState('crude')
  const [resSaving, setResSaving]           = useState(false)
  const [resMsg, setResMsg]                 = useState('')
  const [resSaveBlocked, setResSaveBlocked] = useState(false)
  const importRef                           = useRef()

  // start
  const [starting, setStarting]       = useState(false)
  const [startErr, setStartErr]       = useState('')

  const [colorByOrder, setColorByOrder] = useState(false)
  const [colorByCpg,   setColorByCpg]   = useState(false)
  const [showLabels, setShowLabels]     = useState(false)

  useEffect(() => {
    Promise.all([
      api.get(`/runs/${runId}`),
      api.get(`/runs/${runId}/reagents`),
      api.get('/material-lots'),
    ]).then(([detail, reagentData, lots]) => {
        setData(detail)
        setMaterialLots(lots)

        // Seed results
        const resInit = {}
        for (const l of detail.lines) resInit[l.plate_position] = seedResult(l)
        setResults(resInit)

        // Seed reagents (standard + specials from mod_map)
        const rInit = {}
        REAGENTS.forEach(r => { rInit[r.key] = { ...EMPTY_R } })
        for (const mm of (detail.mod_map || []))
          if (mm.delivery_method !== 'nhs_ester')
            rInit[`mod_${mm.canonical_name}`] = { ...EMPTY_R }
        if ((detail.mod_map || []).some(mm => mm.delivery_method === 'nhs_ester'))
          rInit['ammc6'] = { ...EMPTY_R }
        for (const row of reagentData.reagents) {
          if (rInit[row.reagent_type] !== undefined) rInit[row.reagent_type] = {
            material_lot_id: row.material_lot_id || null,
            lot_number: row.lot_number || '', solvent_lot: row.solvent_lot || '',
            date_replaced: row.date_replaced || '', replaced_by: row.replaced_by || '',
          }
        }
        // Seed conjugation form
        setConjForm(Object.fromEntries(
          ((reagentData.conjugation || [])).map(c => [c.modification_name, {
            reagent_lot: c.reagent_lot || '', date_conjugated: c.date_conjugated || '',
            operator: c.operator || '', notes: c.notes || '',
          }])
        ))
        // Also seed modLotIds for mod_map MW lookup
        const mli = {}
        for (const mm of (detail.mod_map || []))
          if (mm.canonical_name && mm.material_lot_id) mli[mm.canonical_name] = mm.material_lot_id
        setModLotIds(mli)
        setRForm(rInit)

        const cf = {}
        for (const row of reagentData.cpg)
          cf[row.plate_position] = { material_lot_id: row.material_lot_id || null, lot_number: row.lot_number || '' }
        setCpgForm(cf)

        setCarryover(reagentData.carryover_from)
        setRLocked(reagentData.reagents.length > 0 && reagentData.carryover_from === null)
      })
      .catch(() => setErr('Failed to load run'))
      .finally(() => { setLoading(false); setRLoading(false) })
  }, [runId])

  function setR(key, field, val) {
    setRForm(f => ({ ...f, [key]: { ...f[key], [field]: val } }))
  }

  async function saveReagents() {
    setSaving(true); setSaveMsg('')
    try {
      const nhsMods  = (data?.mod_map || []).filter(mm => mm.delivery_method === 'nhs_ester')
      const specials = (data?.mod_map || [])
        .filter(mm => mm.delivery_method !== 'nhs_ester')
        .map(mm => ({
          reagent_type: `mod_${mm.canonical_name}`,
          material_lot_id: rForm[`mod_${mm.canonical_name}`]?.material_lot_id || null,
          lot_number: rForm[`mod_${mm.canonical_name}`]?.lot_number || null,
          solvent_lot: rForm[`mod_${mm.canonical_name}`]?.solvent_lot || null,
          date_replaced: rForm[`mod_${mm.canonical_name}`]?.date_replaced || null,
          replaced_by: rForm[`mod_${mm.canonical_name}`]?.replaced_by || null,
        }))
      if (nhsMods.length > 0) specials.push({
        reagent_type: 'ammc6',
        material_lot_id: rForm['ammc6']?.material_lot_id || null,
        lot_number: rForm['ammc6']?.lot_number || null,
        solvent_lot: rForm['ammc6']?.solvent_lot || null,
        date_replaced: rForm['ammc6']?.date_replaced || null,
        replaced_by: rForm['ammc6']?.replaced_by || null,
      })
      const reagents = [
        ...REAGENTS.map(r => ({
          reagent_type: r.key,
          material_lot_id: rForm[r.key]?.material_lot_id || null,
          lot_number: rForm[r.key]?.lot_number || null,
          solvent_lot: rForm[r.key]?.solvent_lot || null,
          date_replaced: rForm[r.key]?.date_replaced || null,
          replaced_by: rForm[r.key]?.replaced_by || null,
        })),
        ...specials,
      ]
      const conjugation = nhsMods.map(mm => ({
        modification_name: mm.canonical_name,
        reagent_lot:     conjForm[mm.canonical_name]?.reagent_lot     || null,
        date_conjugated: conjForm[mm.canonical_name]?.date_conjugated || null,
        operator:        conjForm[mm.canonical_name]?.operator        || null,
        notes:           conjForm[mm.canonical_name]?.notes           || null,
      }))
      const cpg = lines.map(l => ({
        plate_position: l.plate_position,
        material_lot_id: cpgForm[l.plate_position]?.material_lot_id || null,
        lot_number: cpgForm[l.plate_position]?.lot_number || null,
      }))
      const mod_lots = (data?.mod_map || [])
        .filter(mm => rForm[`mod_${mm.canonical_name}`]?.material_lot_id)
        .map(mm => ({ canonical_name: mm.canonical_name, material_lot_id: rForm[`mod_${mm.canonical_name}`].material_lot_id }))
      await api.put(`/runs/${runId}/reagents`, { reagents, cpg, mod_lots, conjugation })
      setSaveMsg('Saved')
      setCarryover(null)
      setRLocked(true)
      setTimeout(() => setSaveMsg(''), 2500)
    } catch {
      setSaveMsg('Save failed')
    } finally { setSaving(false) }
  }

  async function saveResults(force = false) {
    const undocumented = Object.entries(results)
      .filter(([, r]) => r.status === 'failed' && !r.result_notes?.trim())
    if (!force && undocumented.length > 0) {
      setResMsg(`⚠ ${undocumented.length} failed well${undocumented.length > 1 ? 's' : ''} without notes — add failure reason or save anyway`)
      setResSaveBlocked(true)
      return
    }
    setResSaving(true); setResMsg(''); setResSaveBlocked(false)
    try {
      const num = v => v !== '' && v != null ? parseFloat(v) : null
      const payload = Object.entries(results).map(([pos, r]) => ({
        plate_position:   pos,
        status:           r.status,
        result_notes:     r.result_notes    || null,
        crude_od_260:     num(r.crude_od_260),
        crude_a260_a280:  num(r.crude_a260_a280),
        crude_conc_ng_ul: num(r.crude_conc_ng_ul),
        crude_vol_ul:     num(r.crude_vol_ul),
        purif_method:     r.purif_method    || null,
        purif_date:       r.purif_date      || null,
        purif_operator:   r.purif_operator  || null,
        purif_notes:      r.purif_notes     || null,
        purif_od_260:     num(r.purif_od_260),
        purif_a260_a280:  num(r.purif_a260_a280),
        purif_conc_ng_ul: num(r.purif_conc_ng_ul),
        purif_vol_ul:     num(r.purif_vol_ul),
        ms_done:  r.ms_done  || false,
        ms_pass:  r.ms_pass  ?? null,
        ms_notes: r.ms_notes || null,
        ce_done:  r.ce_done  || false,
        ce_pass:  r.ce_pass  ?? null,
        ce_notes: r.ce_notes || null,
      }))
      await api.put(`/runs/${runId}/results`, { results: payload })
      setResMsg('Saved')
      setTimeout(() => setResMsg(''), 2500)
    } catch {
      setResMsg('Save failed')
    } finally { setResSaving(false) }
  }

  function setRes(pos, field, val) {
    setResults(r => ({ ...r, [pos]: { ...r[pos], [field]: val } }))
  }

  function importNanodrop(e) {
    const file = e.target.files[0]
    if (!file) return
    const stage = resStage  // capture at click time
    const reader = new FileReader()
    reader.onload = ev => {
      const { results: rows, error } = parseNanodropCsv(ev.target.result)
      if (error) { setResMsg(`Import error: ${error}`); return }
      const pfx = stage === 'purif' ? 'purif' : 'crude'
      let matched = 0
      setResults(prev => {
        const next = { ...prev }
        for (const row of rows) {
          if (!next[row.loc]) continue
          const upd = { [`${pfx}_od_260`]: String(row.a260) }
          if (row.ratio != null) upd[`${pfx}_a260_a280`]  = String(row.ratio)
          if (row.conc  != null) upd[`${pfx}_conc_ng_ul`] = String(row.conc)
          next[row.loc] = { ...next[row.loc], ...upd }
          matched++
        }
        return next
      })
      const dest = stage === 'purif' ? 'Purification' : 'Crude QC'
      setResMsg(`Imported ${matched} readings → ${dest}`)
      setTimeout(() => setResMsg(''), 4000)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function markStarted() {
    setStarting(true); setStartErr('')
    try {
      await api.post(`/runs/${runId}/start`, {})
      setData(d => ({ ...d, run: { ...d.run, started_at: new Date().toISOString() } }))
    } catch (e) {
      setStartErr(e.response?.data?.error || 'Failed')
    } finally { setStarting(false) }
  }

  if (loading) return <div className="notice">Loading…</div>
  if (err)     return <div className="notice error">{err}</div>
  if (!data)   return null

  const { run, lines } = data
  const reagentsReady = REAGENTS.every(r => rForm[r.key]?.material_lot_id != null)
  const cpgReady      = lines.every(l => cpgForm[l.plate_position]?.material_lot_id != null)
  const wellMap       = {}
  for (const l of lines) wellMap[l.plate_position] = l

  const cpgLotNames = [...new Set(lines.map(l => cpgForm[l.plate_position]?.lot_number).filter(Boolean))].sort()
  const cpgColor    = {}
  cpgLotNames.forEach((lot, i) => { cpgColor[lot] = CPG_PALETTE[i % CPG_PALETTE.length] })

  return (
    <div className="rl">
      {/* ── header ── */}
      <div className="section-head">
        <div>
          <h2>Run #{run.id}</h2>
          <p>
            {run.created_date}
            {run.synthesizer ? ` · ${run.synthesizer}` : ''}
            {run.operator    ? ` · ${run.operator}` : ''}
            {run.scale_nmol  ? ` · ${run.scale_nmol} nmol` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!run.started_at && (
            <button className="btn-primary"
                    disabled={starting || !reagentsReady || !cpgReady}
                    title={!reagentsReady || !cpgReady ? 'Fill in all reagent lots and CPG before starting' : ''}
                    onClick={markStarted}>
              {starting ? 'Starting…' : '▶ Mark run started'}
            </button>
          )}
          {!run.started_at && (!reagentsReady || !cpgReady) && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Fill reagents &amp; CPG first</span>
          )}
          {run.started_at && (
            <span className="tag rna" style={{ fontSize: 12 }}>Started {run.started_at.slice(0, 10)}</span>
          )}
          <button className="btn-ghost" onClick={() => {
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
            const scale = run.scale_nmol || ''
            triggerDownload(buildCsv(lines, data.mod_map), `RUN ${runId} ${today}${scale ? ` ${scale}nm` : ''}.csv`)
          }}>↓ CSV</button>
          <button className="btn-ghost" onClick={() => setShowLabels(true)}>↓ Shipping Labels</button>
          <button className="btn-ghost" onClick={onBack}>← All runs</button>
        </div>
      </div>

      {startErr && <div className="notice error" style={{ marginBottom: 12 }}>{startErr}</div>}
      {run.notes && <p style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: 13 }}>{run.notes}</p>}

      {showLabels && (
        <ShippingLabelModal api={api} runId={runId} onClose={() => setShowLabels(false)} />
      )}

      {/* ── plate ── */}
      {(() => {
        const orderRefs = [...new Set(lines.map(l => l.order_ref ?? ''))].sort()
        const orderColor = {}
        orderRefs.forEach((ref, i) => { orderColor[ref] = ORDER_PALETTE[i % ORDER_PALETTE.length] })
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={colorByOrder} onChange={e => setColorByOrder(e.target.checked)} />
                Highlight by order
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={colorByCpg} onChange={e => setColorByCpg(e.target.checked)} />
                Highlight by CPG
              </label>
              {colorByOrder && orderRefs.map(ref => (
                <span key={ref} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: orderColor[ref], display: 'inline-block' }} />
                  Order #{ref}
                </span>
              ))}
              {colorByCpg && cpgLotNames.map(lot => (
                <span key={lot} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: cpgColor[lot], display: 'inline-block' }} />
                  {lot}
                </span>
              ))}
            </div>
            <div className="rl-plate-scroll">
              <div className="rl-plate">
                <div />
                {COLS.map(c => <div key={c} className="rl-hdr">{c}</div>)}
                {ROWS.flatMap(row => [
                  <div key={`r${row}`} className="rl-hdr">{row}</div>,
                  ...COLS.map(col => {
                    const pos    = `${row}${col}`
                    const well   = wellMap[pos]
                    const cpgClr = colorByCpg && well ? (cpgColor[cpgForm[pos]?.lot_number] || null) : null
                    const color  = cpgClr || (well && colorByOrder ? orderColor[well.order_ref ?? ''] : null)
                    return (
                      <div key={pos}
                           className={`rl-well ${well ? 'rl-well-filled' : 'rl-well-empty'}`}
                           style={color ? { background: color + '40', borderColor: color } : {}}
                           title={well ? `${pos}: ${well.oligo_name} (${well.order_ref})` : pos}>
                        <span className="rl-well-pos">{pos}</span>
                        {well && <>
                          <span className="rl-well-name">{well.oligo_name}</span>
                          <span className="rl-well-ref mono">{well.order_ref}</span>
                          <span className="rl-dmt-chip"
                                style={(well.dmt || 'DMT OFF') === 'DMT ON'
                                  ? { borderColor: '#f97316', color: '#f97316', background: '#f9731628' }
                                  : {}}>
                            {well.dmt || 'DMT OFF'}
                          </span>
                        </>}
                      </div>
                    )
                  })
                ])}
              </div>
            </div>
          </>
        )
      })()}

      {/* ── reagents ── */}
      <div className="rl-section">
        <div className="rl-section-hdr">
          <h3>Reagent Info</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {carryover && !rLocked && (
              <span className="rl-carryover">Carried over from Run #{carryover} — update what changed</span>
            )}
            {rLocked
              ? <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setRLocked(false)}>Edit</button>
              : <>
                  {saveMsg && <span style={{ fontSize: 13, color: saveMsg === 'Saved' ? 'var(--accent)' : '#ef4444' }}>{saveMsg}</span>}
                  <button className="btn-primary" disabled={saving} onClick={saveReagents}>
                    {saving ? 'Saving…' : 'Commit reagents & CPG'}
                  </button>
                </>
            }
          </div>
        </div>

        {rLoading ? <div className="notice">Loading…</div> : rLocked ? (
          /* ── locked read-only view ── */
          <>
            <table className="rl-rtable">
              <thead>
                <tr><th>Reagent</th><th>Lot #</th><th>Full name</th><th>Solvent lot</th><th>Date replaced</th><th>Replaced by</th></tr>
              </thead>
              <tbody>
                {REAGENTS.map(r => {
                  const v = rForm[r.key] || EMPTY_R
                  const fullName = materialLots.find(l => l.id === v.material_lot_id)?.name || '—'
                  return (
                    <tr key={r.key}>
                      <td className="rl-reagent-label">{r.label}</td>
                      <td className="mono">{v.lot_number || '—'}</td>
                      <td>{fullName}</td>
                      <td className="mono">{r.amidite ? (v.solvent_lot || '—') : <span className="rl-na">—</span>}</td>
                      <td className="mono">{v.date_replaced || '—'}</td>
                      <td>{v.replaced_by || '—'}</td>
                    </tr>
                  )
                })}
                {(data?.mod_map || []).filter(mm => mm.delivery_method !== 'nhs_ester').map(mm => {
                  const v = rForm[`mod_${mm.canonical_name}`] || EMPTY_R
                  const fullName = materialLots.find(l => l.id === v.material_lot_id)?.name || '—'
                  return (
                    <tr key={`mod_${mm.canonical_name}`}>
                      <td className="rl-reagent-label">
                        {mm.canonical_name}
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>pos {mm.synth_slot}</span>
                      </td>
                      <td className="mono">{v.lot_number || '—'}</td>
                      <td>{fullName}</td>
                      <td className="mono">{v.solvent_lot || '—'}</td>
                      <td className="mono">{v.date_replaced || '—'}</td>
                      <td>{v.replaced_by || '—'}</td>
                    </tr>
                  )
                })}
                {(data?.mod_map || []).some(mm => mm.delivery_method === 'nhs_ester') && (() => {
                  const v = rForm['ammc6'] || EMPTY_R
                  const fullName = materialLots.find(l => l.id === v.material_lot_id)?.name || '—'
                  const nhsSlots = (data?.mod_map || []).filter(mm => mm.delivery_method === 'nhs_ester').map(mm => mm.synth_slot).join(', ')
                  return (
                    <tr key="ammc6">
                      <td className="rl-reagent-label">
                        AmMC6
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>pos {nhsSlots}</span>
                      </td>
                      <td className="mono">{v.lot_number || '—'}</td>
                      <td>{fullName}</td>
                      <td className="mono">{v.solvent_lot || '—'}</td>
                      <td className="mono">{v.date_replaced || '—'}</td>
                      <td>{v.replaced_by || '—'}</td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
            {/* CPG read-only */}
            <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
              <h3>CPG (per column)</h3>
            </div>
            <div style={{ padding: '12px 14px' }}>
              <div className="rl-plate-scroll">
                <div className="rl-plate">
                  <div />
                  {COLS.map(c => <div key={c} className="rl-hdr">{c}</div>)}
                  {ROWS.flatMap(row => [
                    <div key={`r${row}`} className="rl-hdr">{row}</div>,
                    ...COLS.map(col => {
                      const pos   = `${row}${col}`
                      const well  = wellMap[pos]
                      const lot   = well ? (cpgForm[pos]?.lot_number || null) : null
                      const color = lot ? cpgColor[lot] : null
                      return (
                        <div key={pos}
                             className={`rl-well ${well ? 'rl-well-filled' : 'rl-well-empty'}`}
                             style={color ? { background: color + '40', borderColor: color } : {}}
                             title={well ? `${pos}: ${well.oligo_name} — CPG: ${lot || '—'}` : pos}>
                          <span className="rl-well-pos">{pos}</span>
                          {well && lot && (
                            <span style={{
                              marginTop: 2,
                              fontSize: 9,
                              padding: '1px 4px',
                              borderRadius: 3,
                              background: color + '30',
                              border: `1px solid ${color}`,
                              color,
                              fontFamily: 'var(--mono)',
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '100%',
                            }}>{lot}</span>
                          )}
                        </div>
                      )
                    })
                  ])}
                </div>
              </div>
              {cpgLotNames.length > 0 && (
                <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  {cpgLotNames.map(lot => (
                    <span key={lot} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: cpgColor[lot], display: 'inline-block' }} />
                      {lot}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {(data?.mod_map || []).some(mm => mm.delivery_method === 'nhs_ester') && (
              <>
                <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                  <h3>NHS Ester Conjugation</h3>
                </div>
                <table className="rl-rtable" style={{ margin: '0 14px 14px' }}>
                  <thead><tr><th>Modification</th><th>NHS ester lot</th><th>Date conjugated</th><th>Operator</th><th>Notes</th></tr></thead>
                  <tbody>
                    {(data?.mod_map || []).filter(mm => mm.delivery_method === 'nhs_ester').map(mm => (
                      <tr key={mm.canonical_name}>
                        <td className="rl-reagent-label">{mm.canonical_name}</td>
                        <td className="mono">{conjForm[mm.canonical_name]?.reagent_lot || '—'}</td>
                        <td className="mono">{conjForm[mm.canonical_name]?.date_conjugated || '—'}</td>
                        <td>{conjForm[mm.canonical_name]?.operator || '—'}</td>
                        <td>{conjForm[mm.canonical_name]?.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        ) : (
          /* ── editable form ── */
          <>
            <table className="rl-rtable">
              <thead>
                <tr><th>Reagent</th><th>Lot #</th><th>Full name</th><th>Solvent lot</th><th>Date replaced</th><th>Replaced by</th></tr>
              </thead>
              <tbody>
                {REAGENTS.map(r => {
                  const v = rForm[r.key] || EMPTY_R
                  const cn = REAGENT_CANONICAL[r.key]
                  const available = materialLots.filter(l =>
                    l.material_type === (r.amidite ? 'amidite' : 'reagent') && l.canonical_name === cn
                  )
                  const fullName = materialLots.find(l => l.id === v.material_lot_id)?.name || ''
                  return (
                    <tr key={r.key}>
                      <td className="rl-reagent-label">{r.label}</td>
                      <td>
                        <select className="rl-input rl-select"
                                value={v.material_lot_id ?? ''}
                                onChange={e => {
                                  const id = e.target.value ? parseInt(e.target.value) : null
                                  const lot = materialLots.find(l => l.id === id)
                                  setR(r.key, 'material_lot_id', id)
                                  if (lot) setR(r.key, 'lot_number', lot.lot_number)
                                }}>
                          <option value="">— select lot —</option>
                          {available.map(l => (
                            <option key={l.id} value={l.id}>
                              {l.lot_number}{l.provider ? ` (${l.provider})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fullName || <span className="rl-na">—</span>}</td>
                      <td>{r.amidite
                        ? <input className="rl-input" value={v.solvent_lot} onChange={e => setR(r.key, 'solvent_lot', e.target.value)} />
                        : <span className="rl-na">—</span>}
                      </td>
                      <td><input type="date" className="rl-input rl-date" value={v.date_replaced} onChange={e => setR(r.key, 'date_replaced', e.target.value)} /></td>
                      <td><input className="rl-input" value={v.replaced_by} onChange={e => setR(r.key, 'replaced_by', e.target.value)} /></td>
                    </tr>
                  )
                })}
                {(data?.mod_map || []).filter(mm => mm.delivery_method !== 'nhs_ester').map(mm => {
                  const key  = `mod_${mm.canonical_name}`
                  const v    = rForm[key] || EMPTY_R
                  const avail = materialLots.filter(l => l.material_type === 'amidite' && l.canonical_name === mm.canonical_name)
                  const fullName = materialLots.find(l => l.id === v.material_lot_id)?.name || ''
                  return (
                    <tr key={key}>
                      <td className="rl-reagent-label">
                        {mm.canonical_name}
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>pos {mm.synth_slot}</span>
                      </td>
                      <td>
                        <select className="rl-input rl-select"
                                value={v.material_lot_id ?? ''}
                                onChange={e => {
                                  const id = e.target.value ? parseInt(e.target.value) : null
                                  const lot = materialLots.find(l => l.id === id)
                                  setR(key, 'material_lot_id', id)
                                  if (lot) setR(key, 'lot_number', lot.lot_number)
                                }}>
                          <option value="">— select lot —</option>
                          {avail.map(l => (
                            <option key={l.id} value={l.id}>{l.lot_number}{l.provider ? ` (${l.provider})` : ''}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fullName || <span className="rl-na">—</span>}</td>
                      <td><input className="rl-input" value={v.solvent_lot} onChange={e => setR(key, 'solvent_lot', e.target.value)} /></td>
                      <td><input type="date" className="rl-input rl-date" value={v.date_replaced} onChange={e => setR(key, 'date_replaced', e.target.value)} /></td>
                      <td><input className="rl-input" value={v.replaced_by} onChange={e => setR(key, 'replaced_by', e.target.value)} /></td>
                    </tr>
                  )
                })}
                {(data?.mod_map || []).some(mm => mm.delivery_method === 'nhs_ester') && (() => {
                  const v = rForm['ammc6'] || EMPTY_R
                  const avail = materialLots.filter(l => l.material_type === 'amidite' && l.canonical_name === 'AmMC6')
                  const fullName = materialLots.find(l => l.id === v.material_lot_id)?.name || ''
                  const nhsSlots = (data?.mod_map || []).filter(mm => mm.delivery_method === 'nhs_ester').map(mm => mm.synth_slot).join(', ')
                  return (
                    <tr key="ammc6">
                      <td className="rl-reagent-label">
                        AmMC6
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>pos {nhsSlots}</span>
                      </td>
                      <td>
                        <select className="rl-input rl-select"
                                value={v.material_lot_id ?? ''}
                                onChange={e => {
                                  const id = e.target.value ? parseInt(e.target.value) : null
                                  const lot = materialLots.find(l => l.id === id)
                                  setR('ammc6', 'material_lot_id', id)
                                  if (lot) setR('ammc6', 'lot_number', lot.lot_number)
                                }}>
                          <option value="">— select lot —</option>
                          {avail.map(l => (
                            <option key={l.id} value={l.id}>{l.lot_number}{l.provider ? ` (${l.provider})` : ''}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fullName || <span className="rl-na">—</span>}</td>
                      <td><input className="rl-input" value={v.solvent_lot} onChange={e => setR('ammc6', 'solvent_lot', e.target.value)} /></td>
                      <td><input type="date" className="rl-input rl-date" value={v.date_replaced} onChange={e => setR('ammc6', 'date_replaced', e.target.value)} /></td>
                      <td><input className="rl-input" value={v.replaced_by} onChange={e => setR('ammc6', 'replaced_by', e.target.value)} /></td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
            {/* CPG editable */}
            <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
              <h3>CPG (per well)</h3>
              <div className="rl-fillaAll">
                <select className="rl-input" value={fillAll} onChange={e => setFillAll(e.target.value)}>
                  <option value="">Select lot to fill all…</option>
                  {materialLots.filter(l => l.material_type === 'cpg').map(l => (
                    <option key={l.id} value={l.id}>{l.lot_number}{l.provider ? ` (${l.provider})` : ''}</option>
                  ))}
                </select>
                <button className="btn-ghost" onClick={() => {
                  if (!fillAll) return
                  const id = parseInt(fillAll)
                  const lot = materialLots.find(l => l.id === id)
                  if (!lot) return
                  setCpgForm(f => {
                    const n = { ...f }
                    lines.forEach(l => { n[l.plate_position] = { material_lot_id: id, lot_number: lot.lot_number } })
                    return n
                  })
                }}>Fill all</button>
              </div>
            </div>
            <div style={{ padding: '12px 14px' }}>
              {(() => {
                const cpgLots = materialLots.filter(l => l.material_type === 'cpg')
                return (
                  <div className="rl-plate-scroll">
                    <div className="rl-plate">
                      <div />
                      {COLS.map(c => <div key={c} className="rl-hdr">{c}</div>)}
                      {ROWS.flatMap(row => [
                        <div key={`r${row}`} className="rl-hdr">{row}</div>,
                        ...COLS.map(col => {
                          const pos  = `${row}${col}`
                          const well = wellMap[pos]
                          const val  = cpgForm[pos]
                          const color = val?.lot_number ? cpgColor[val.lot_number] : null
                          return (
                            <div key={pos}
                                 className="rl-well"
                                 style={
                                   !well
                                     ? { background: 'var(--surface)', borderColor: 'var(--border)', opacity: 0.4 }
                                     : color
                                       ? { background: color + '40', borderColor: color, borderWidth: 1.5 }
                                       : { background: 'var(--surface)', borderColor: 'var(--border)' }
                                 }>
                              <span className="rl-well-pos">{pos}</span>
                              {well && (
                                <select
                                  className="rl-cpg-well-select"
                                  value={val?.material_lot_id ?? ''}
                                  onChange={e => {
                                    const id = e.target.value ? parseInt(e.target.value) : null
                                    const lot = materialLots.find(l => l.id === id)
                                    setCpgForm(f => ({ ...f, [pos]: { material_lot_id: id, lot_number: lot ? lot.lot_number : '' } }))
                                  }}>
                                  <option value="">—</option>
                                  {cpgLots.map(l => (
                                    <option key={l.id} value={l.id}>{l.lot_number}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          )
                        })
                      ])}
                    </div>
                  </div>
                )
              })()}
            </div>
            {(data?.mod_map || []).some(mm => mm.delivery_method === 'nhs_ester') && (
              <>
                <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                  <h3>NHS Ester Conjugation</h3>
                </div>
                <div style={{ padding: '0 14px 14px' }}>
                  <table className="rl-rtable">
                    <thead>
                      <tr><th>Modification</th><th>NHS ester lot</th><th>Date conjugated</th><th>Operator</th><th>Notes</th></tr>
                    </thead>
                    <tbody>
                      {(data?.mod_map || []).filter(mm => mm.delivery_method === 'nhs_ester').map(mm => {
                        const n = mm.canonical_name
                        return (
                          <tr key={n}>
                            <td className="rl-reagent-label">{n}</td>
                            <td><input className="rl-input" placeholder="lot #"
                                       value={conjForm[n]?.reagent_lot ?? ''}
                                       onChange={e => setConjForm(f => ({ ...f, [n]: { ...f[n], reagent_lot: e.target.value } }))} /></td>
                            <td><input type="date" className="rl-input rl-date"
                                       value={conjForm[n]?.date_conjugated ?? ''}
                                       onChange={e => setConjForm(f => ({ ...f, [n]: { ...f[n], date_conjugated: e.target.value } }))} /></td>
                            <td><input className="rl-input"
                                       value={conjForm[n]?.operator ?? ''}
                                       onChange={e => setConjForm(f => ({ ...f, [n]: { ...f[n], operator: e.target.value } }))} /></td>
                            <td><input className="rl-input"
                                       value={conjForm[n]?.notes ?? ''}
                                       onChange={e => setConjForm(f => ({ ...f, [n]: { ...f[n], notes: e.target.value } }))} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── results (only after started) ── */}
      {run.started_at && (
        <div className="rl-section">
          <div className="rl-section-hdr" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ margin: 0 }}>Results</h3>
              <div className="rl-stage-tabs">
                {STAGES.map(([id, label]) => (
                  <button key={id}
                          className={`rl-stage-tab ${resStage === id ? 'active' : ''}`}
                          onClick={() => setResStage(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {resMsg && (
                <span style={{ fontSize: 13, color: resMsg === 'Saved' || resMsg.startsWith('Imported') ? 'var(--accent)' : '#ef4444' }}>
                  {resMsg}
                </span>
              )}
              {resStage !== 'qc' && <>
                <button className="btn-ghost" onClick={() => triggerDownload(buildNameFile(lines), `RUN${runId}_nanodrop_names.csv`)}>
                  ↓ NanoDrop names
                </button>
                <button className="btn-ghost" onClick={() => importRef.current?.click()}>
                  ↑ Import NanoDrop {resStage === 'purif' ? '(purified)' : '(crude)'}
                </button>
                <input ref={importRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={importNanodrop} />
              </>}
              {resSaveBlocked
                ? <button className="btn-primary" style={{ background: '#ef4444', borderColor: '#ef4444' }}
                          disabled={resSaving} onClick={() => saveResults(true)}>Save anyway</button>
                : <button className="btn-primary" disabled={resSaving} onClick={() => saveResults()}>
                    {resSaving ? 'Saving…' : 'Save results'}
                  </button>
              }
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="rl-rtable">
              <thead>
                <tr>
                  <th>Pos</th><th>Name</th>
                  {resStage === 'crude' && <>
                    <th>Status</th><th>OD₂₆₀</th><th>A260/A280</th><th>Conc (ng/µL)</th><th>Vol (µL)</th><th>Notes</th>
                  </>}
                  {resStage === 'purif' && <>
                    <th>Method</th><th>Date</th><th>Operator</th><th>Notes</th>
                    <th>OD₂₆₀</th><th>A260/A280</th><th>Conc (ng/µL)</th><th>Vol (µL)</th>
                  </>}
                  {resStage === 'qc' && <>
                    <th>MS</th><th>MS result</th><th>MS notes</th>
                    <th>CE</th><th>CE result</th><th>CE notes</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {colMajorSort(lines).map(l => {
                  const r = results[l.plate_position] || emptyResult()
                  return (
                    <tr key={l.plate_position}>
                      <td className="mono primary">{l.plate_position}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{l.oligo_name}</td>

                      {resStage === 'crude' && <>
                        <td>
                          <select className="rl-input rl-select" value={r.status || 'pending'}
                                  onChange={e => { setRes(l.plate_position, 'status', e.target.value); setResSaveBlocked(false) }}>
                            {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td><input type="number" step="0.001" min="0" className="rl-input rl-num" placeholder="—"
                                   value={r.crude_od_260} onChange={e => setRes(l.plate_position, 'crude_od_260', e.target.value)} /></td>
                        <td><input type="number" step="0.01"  min="0" className="rl-input rl-num" placeholder="—"
                                   value={r.crude_a260_a280} onChange={e => setRes(l.plate_position, 'crude_a260_a280', e.target.value)} /></td>
                        <td><input type="number" step="0.1"   min="0" className="rl-input rl-num" placeholder="—"
                                   value={r.crude_conc_ng_ul} onChange={e => setRes(l.plate_position, 'crude_conc_ng_ul', e.target.value)} /></td>
                        <td><input type="number" step="0.1"   min="0" className="rl-input rl-num" placeholder="—"
                                   value={r.crude_vol_ul} onChange={e => setRes(l.plate_position, 'crude_vol_ul', e.target.value)} /></td>
                        <td>
                          <input className="rl-input"
                                 placeholder={r.status === 'failed' ? 'Document failure reason…' : '—'}
                                 value={r.result_notes}
                                 style={r.status === 'failed' && !r.result_notes?.trim()
                                   ? { borderColor: '#ef4444', background: 'rgba(239,68,68,0.06)' } : {}}
                                 onChange={e => { setRes(l.plate_position, 'result_notes', e.target.value); setResSaveBlocked(false) }} />
                        </td>
                      </>}

                      {resStage === 'purif' && <>
                        <td>
                          <select className="rl-input rl-select" style={{ minWidth: 120 }}
                                  value={r.purif_method} onChange={e => setRes(l.plate_position, 'purif_method', e.target.value)}>
                            <option value="">—</option>
                            {PURIF_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </td>
                        <td><input type="date" className="rl-input rl-date" value={r.purif_date}
                                   onChange={e => setRes(l.plate_position, 'purif_date', e.target.value)} /></td>
                        <td><input className="rl-input" placeholder="—" value={r.purif_operator}
                                   onChange={e => setRes(l.plate_position, 'purif_operator', e.target.value)} /></td>
                        <td><input className="rl-input" placeholder="—" value={r.purif_notes}
                                   onChange={e => setRes(l.plate_position, 'purif_notes', e.target.value)} /></td>
                        <td><input type="number" step="0.001" min="0" className="rl-input rl-num" placeholder="—"
                                   value={r.purif_od_260} onChange={e => setRes(l.plate_position, 'purif_od_260', e.target.value)} /></td>
                        <td><input type="number" step="0.01"  min="0" className="rl-input rl-num" placeholder="—"
                                   value={r.purif_a260_a280} onChange={e => setRes(l.plate_position, 'purif_a260_a280', e.target.value)} /></td>
                        <td><input type="number" step="0.1"   min="0" className="rl-input rl-num" placeholder="—"
                                   value={r.purif_conc_ng_ul} onChange={e => setRes(l.plate_position, 'purif_conc_ng_ul', e.target.value)} /></td>
                        <td><input type="number" step="0.1"   min="0" className="rl-input rl-num" placeholder="—"
                                   value={r.purif_vol_ul} onChange={e => setRes(l.plate_position, 'purif_vol_ul', e.target.value)} /></td>
                      </>}

                      {resStage === 'qc' && <>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={r.ms_done}
                                 onChange={e => setRes(l.plate_position, 'ms_done', e.target.checked)} />
                        </td>
                        <td>
                          {r.ms_done && (
                            <select className="rl-input rl-select"
                                    value={r.ms_pass == null ? '' : (r.ms_pass ? 'pass' : 'fail')}
                                    onChange={e => setRes(l.plate_position, 'ms_pass',
                                      e.target.value === '' ? null : e.target.value === 'pass')}>
                              <option value="">—</option>
                              <option value="pass">Pass</option>
                              <option value="fail">Fail</option>
                            </select>
                          )}
                        </td>
                        <td>
                          {r.ms_done && <input className="rl-input" placeholder="—" value={r.ms_notes}
                                               onChange={e => setRes(l.plate_position, 'ms_notes', e.target.value)} />}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={r.ce_done}
                                 onChange={e => setRes(l.plate_position, 'ce_done', e.target.checked)} />
                        </td>
                        <td>
                          {r.ce_done && (
                            <select className="rl-input rl-select"
                                    value={r.ce_pass == null ? '' : (r.ce_pass ? 'pass' : 'fail')}
                                    onChange={e => setRes(l.plate_position, 'ce_pass',
                                      e.target.value === '' ? null : e.target.value === 'pass')}>
                              <option value="">—</option>
                              <option value="pass">Pass</option>
                              <option value="fail">Fail</option>
                            </select>
                          )}
                        </td>
                        <td>
                          {r.ce_done && <input className="rl-input" placeholder="—" value={r.ce_notes}
                                               onChange={e => setRes(l.plate_position, 'ce_notes', e.target.value)} />}
                        </td>
                      </>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── run lines ── */}
      <div className="rl-section">
        <div className="rl-section-hdr" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h3>Run Lines ({lines.length})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400, cursor: 'pointer' }}>
            <input type="checkbox" checked={colorByOrder} onChange={e => setColorByOrder(e.target.checked)} />
            Highlight by order
          </label>
        </div>
        {(() => {
          const orderRefs = [...new Set(lines.map(l => l.order_ref ?? ''))].sort()
          const orderColor = {}
          orderRefs.forEach((ref, i) => { orderColor[ref] = ORDER_PALETTE[i % ORDER_PALETTE.length] })
          return (
            <>
              {colorByOrder && orderRefs.length > 1 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  {orderRefs.map(ref => (
                    <span key={ref} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: orderColor[ref], display: 'inline-block' }} />
                      Order #{ref}
                    </span>
                  ))}
                </div>
              )}
              <table className="rl-table">
                <thead>
                  <tr><th>Pos</th><th>Name</th><th>Order</th><th>Type</th><th>Sequence</th><th>nt</th><th>MW calc (Da)</th></tr>
                </thead>
                <tbody>
                  {colMajorSort(lines).map(l => {
                    const color = colorByOrder ? orderColor[l.order_ref ?? ''] : null
                    return (
                      <tr key={l.plate_position}
                          style={color ? { borderLeft: `3px solid ${color}`, background: color + '18' } : {}}>
                        <td className="mono primary">{l.plate_position}</td>
                        <td>{l.oligo_name}</td>
                        <td className="mono">{l.order_ref}</td>
                        <td><span className={`tag ${l.oligo_type === 'DNA' ? '' : 'rna'}`}>{l.oligo_type ?? '—'}</span></td>
                        <td className="mono rl-seq">{l.synth_sequence || applyModMap(l.annotated_sequence || '', data.mod_map)}</td>
                        <td className="mono">{l.length_nt}</td>
                        <td className="mono">{l.calc_mw != null ? l.calc_mw.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )
        })()}
      </div>
    </div>
  )
}

// ── RunList ───────────────────────────────────────────────────────────────────
export default function RunList({ api, initialRunId }) {
  const [runs, setRuns]       = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')
  const [openId, setOpenId]   = useState(initialRunId ?? null)

  const [menuOpen, setMenuOpen]       = useState(null)
  const menuRef                       = useRef()
  const [deleteRun, setDeleteRun]     = useState(null)
  const [deleting, setDeleting]       = useState(false)
  const [deleteErr, setDeleteErr]     = useState('')

  useEffect(() => {
    api.get('/runs')
      .then(setRuns)
      .catch(() => setErr('Failed to load runs'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  function openDelete(r) {
    setDeleteRun(r)
    setDeleteErr('')
    setMenuOpen(null)
  }

  async function confirmDelete() {
    setDeleting(true); setDeleteErr('')
    try {
      await api.del(`/runs/${deleteRun.id}`)
      setRuns(rs => rs.filter(r => r.id !== deleteRun.id))
      setDeleteRun(null)
    } catch (err) {
      setDeleteErr(err.response?.data?.error || 'Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <div className="notice">Loading…</div>
  if (err)     return <div className="notice error">{err}</div>

  if (openId != null)
    return <RunDetail api={api} runId={openId} onBack={() => setOpenId(null)} />

  if (runs.length === 0)
    return (
      <div>
        <div className="section-head"><div><h2>Runs</h2><p>No synthesis runs yet.</p></div></div>
      </div>
    )

  return (
    <div className="rl">
      <div className="section-head">
        <div><h2>Runs</h2><p>{runs.length} synthesis run{runs.length !== 1 ? 's' : ''}</p></div>
      </div>
      <table className="rl-table">
        <thead>
          <tr>
            <th>Run #</th><th>Date</th><th>Synthesizer</th><th>Operator</th>
            <th>Scale</th><th>Wells</th><th>Orders</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} className="rl-row-link" onClick={() => setOpenId(r.id)}>
              <td className="mono primary">#{r.id}</td>
              <td className="mono">{r.created_date}</td>
              <td>{r.synthesizer || '—'}</td>
              <td>{r.operator || '—'}</td>
              <td className="mono">{r.scale_nmol ? `${r.scale_nmol} nmol` : '—'}</td>
              <td className="mono">{r.well_count}</td>
              <td>
                {(() => {
                  const refs = r.order_refs || []
                  const chunks = []
                  for (let i = 0; i < refs.length; i += 4) chunks.push(refs.slice(i, i + 4))
                  return chunks.map((chunk, ci) => (
                    <div key={ci} style={{ display: 'flex', gap: 4, marginBottom: ci < chunks.length - 1 ? 4 : 0 }}>
                      {chunk.map(ref => <span key={ref} className="tag">{ref}</span>)}
                    </div>
                  ))
                })()}
              </td>
              <td>
                {r.started_at
                  ? <span className="tag rna">Started {r.started_at.slice(0, 10)}</span>
                  : <span className="tag">Pending</span>}
              </td>
              <td style={{ position: 'relative', width: 32, padding: '0 4px' }}
                  onClick={e => e.stopPropagation()}>
                <button
                  className="btn-ghost"
                  style={{ padding: '2px 8px', fontSize: 16, lineHeight: 1 }}
                  onClick={() => setMenuOpen(menuOpen === r.id ? null : r.id)}>
                  ⋮
                </button>
                {menuOpen === r.id && (
                  <div ref={menuRef}
                       style={{
                         position: 'absolute', right: 0, top: '100%', zIndex: 100,
                         background: 'var(--surface)', border: '1px solid var(--border)',
                         borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                         minWidth: 140, padding: '4px 0',
                       }}>
                    <button className="btn-ghost"
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', borderRadius: 0, color: '#ef4444' }}
                            onClick={() => openDelete(r)}>
                      Delete run
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {deleteRun && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }} onClick={() => setDeleteRun(null)}>
          <div style={{
            background: 'var(--surface)', borderRadius: 10, padding: 28,
            minWidth: 320, maxWidth: 440, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 10 }}>Delete run #{deleteRun.id}?</h3>
            <p style={{ color: 'var(--text-dim)', marginBottom: 18 }}>
              This will permanently remove the run and all its well assignments.
              This cannot be undone.
            </p>
            {deleteErr && <div className="notice error" style={{ marginBottom: 12 }}>{deleteErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setDeleteRun(null)}>Cancel</button>
              <button className="btn-primary"
                      style={{ background: '#ef4444', borderColor: '#ef4444' }}
                      disabled={deleting}
                      onClick={confirmDelete}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
