import { useState, useEffect, useMemo } from 'react'
import './SynthesisRunBuilder.css'
import './RunList.css'

const ROWS     = ['A','B','C','D','E','F','G','H']
const COLS     = Array.from({ length: 12 }, (_, i) => i + 1)
const CAPACITY = 96
const PALETTE  = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#06b6d4','#f97316','#84cc16']
const PRIMER_COLOR = '#4b5563'

const REAGENTS = [
  { key: 'wash',      label: 'Wash',      amidite: false },
  { key: 'oxidizer',  label: 'Oxidizer',  amidite: false },
  { key: 'cap_a',     label: 'Cap A',     amidite: false },
  { key: 'cap_b',     label: 'Cap B',     amidite: false },
  { key: 'activator', label: 'Activator', amidite: false },
  { key: 'amidite_a', label: 'Amidite A', amidite: true  },
  { key: 'amidite_c', label: 'Amidite C', amidite: true  },
  { key: 'amidite_g', label: 'Amidite G', amidite: true  },
  { key: 'amidite_t', label: 'Amidite T', amidite: true  },
]
const REAGENT_CANONICAL = {
  wash: 'wash', oxidizer: 'oxidizer', cap_a: 'cap_a', cap_b: 'cap_b', activator: 'activator',
  amidite_a: 'dA', amidite_c: 'dC', amidite_g: 'dG', amidite_t: 'dT',
}
const EMPTY_R = { material_lot_id: null, lot_number: '', solvent_lot: '', date_replaced: '', replaced_by: '' }
function initRForm() { const f = {}; REAGENTS.forEach(r => { f[r.key] = { ...EMPTY_R } }); return f }
function initCpgForm() { const f = {}; COLS.forEach(c => { f[c] = { material_lot_id: null, lot_number: '' } }); return f }

// ── plate algorithm (pure functions) ─────────────────────────────────────────

function getModProfile(item, machineNames) {
  return (item.tokens?.modifications ?? [])
    .filter(m => machineNames.has(m.canonical_name))
    .map(m => m.canonical_name)
    .sort()
    .join(',')
}

// All oligos at copy-level 1 first, then copy-level 2, etc.
// Ideal for row-fill: each "copy wave" fills one complete row.
function expandByRows(items) {
  const max = Math.max(0, ...items.map(x => x.copies))
  const out = []
  for (let ci = 1; ci <= max; ci++)
    for (const item of items)
      if (ci <= item.copies) out.push({ ...item, copyNum: ci })
  return out
}

// All copies of item 1, then item 2, etc.
// Ideal for column-fill: each item's copies run down one column.
function expandByCols(items) {
  return items.flatMap(item =>
    Array.from({ length: item.copies }, (_, ci) => ({ ...item, copyNum: ci + 1 }))
  )
}

function buildPlate(selection, machineNames, fillMode, groupMods, groupOrders) {
  const wellMap = {}
  for (const r of ROWS) for (const c of COLS)
    wellMap[`${r}${c}`] = { pos: `${r}${c}`, item: null, color: null }

  const byLength = (a, b) =>
    (b.annotated_sequence?.length ?? 0) - (a.annotated_sequence?.length ?? 0)

  const items = Object.values(selection)

  // Build order color map (stable: sort refs so colour assignment is deterministic)
  const orderRefs = [...new Set(items.map(x => x.order_ref ?? ''))].sort()
  const orderColorMap = {}
  orderRefs.forEach((ref, i) => { orderColorMap[ref] = PALETTE[i % PALETTE.length] })

  const byOrder = (a, b) => {
    const oc = (a.order_ref ?? '').localeCompare(b.order_ref ?? '')
    return oc !== 0 ? oc : byLength(a, b)
  }

  if (!groupMods) {
    const sorted = [...items].sort(groupOrders ? byOrder : byLength)
    const expanded = fillMode === 'rows' ? expandByRows(sorted) : expandByCols(sorted)
    const positions = fillMode === 'rows'
      ? ROWS.flatMap(r => COLS.map(c => `${r}${c}`))
      : COLS.flatMap(c => ROWS.map(r => `${r}${c}`))
    expanded.slice(0, CAPACITY).forEach((item, i) => {
      const color = groupOrders ? orderColorMap[item.order_ref ?? ''] : PRIMER_COLOR
      wellMap[positions[i]] = { pos: positions[i], item, color }
    })
    const legend = groupOrders
      ? orderRefs.map(ref => ({ color: orderColorMap[ref], label: `Order #${ref}`, slots: null }))
      : []
    return { wellMap, slotFor: {}, colorFor: {}, legend, totalUsed: expanded.length }
  }

  // ── grouped mode ──────────────────────────────────────────────────────────
  // Modified: one column per oligo (longest → col 1), one row per copy level
  // Primers : one row per primer  (longest → first), copies fill left to right
  // Both sections stacked vertically → minimises circumference

  const sortFn = groupOrders ? byOrder : byLength
  const modItems  = [...items.filter(x =>  getModProfile(x, machineNames))].sort(sortFn)
  const primItems = [...items.filter(x => !getModProfile(x, machineNames))].sort(sortFn)

  // Assign colours and reagent slots to distinct mod profiles
  const profileOrder = [...new Set(modItems.map(x => getModProfile(x, machineNames)))]
  const colorFor = {}, slotFor = {}
  let paletteIdx = 0, slot = 1
  for (const p of profileOrder) {
    colorFor[p] = PALETTE[paletteIdx++ % PALETTE.length]
    for (const name of p.split(',').filter(Boolean))
      if (!slotFor[name] && slot <= 9) slotFor[name] = slot++
  }

  // Modified block: col index = oligo rank, row index = copyNum - 1
  const rowsMod = modItems.length > 0 ? Math.max(...modItems.map(x => x.copies)) : 0
  for (let ci = 0; ci < modItems.length && ci < 12; ci++) {
    const item = modItems[ci]
    const p = getModProfile(item, machineNames)
    for (let copyNum = 1; copyNum <= item.copies && (copyNum - 1) < 8; copyNum++) {
      const pos = `${ROWS[copyNum - 1]}${ci + 1}`
      wellMap[pos] = { pos, item: { ...item, copyNum }, color: colorFor[p] }
    }
  }

  // Primer block: each primer gets one row starting at rowsMod
  for (let pi = 0; pi < primItems.length; pi++) {
    const rowIdx = rowsMod + pi
    if (rowIdx >= 8) break
    const primer = primItems[pi]
    for (let ci = 0; ci < primer.copies && ci < 12; ci++) {
      const pos = `${ROWS[rowIdx]}${ci + 1}`
      wellMap[pos] = { pos, item: { ...primer, copyNum: ci + 1 }, color: PRIMER_COLOR }
    }
  }

  const legend = []
  if (primItems.length)
    legend.push({ color: PRIMER_COLOR, label: 'Primers (unmodified)', slots: null })
  for (const p of profileOrder)
    legend.push({
      color: colorFor[p],
      label: p || 'Modified',
      slots: p.split(',').filter(Boolean).map(n => `${n} → slot ${slotFor[n] ?? '?'}`).join(', '),
    })

  const totalMod  = modItems.reduce((s, x) => s + x.copies, 0)
  const totalPrim = primItems.reduce((s, x) => s + x.copies, 0)
  return { wellMap, slotFor, colorFor, legend, totalUsed: totalMod + totalPrim }
}

function statusClass(status) {
  if (status === 'in_progress') return 'rna'
  if (status === 'completed' || status === 'done') return 'done'
  return ''
}

const LINE_STATUS = {
  queued:             { label: 'queued',                  cls: '' },
  in_progress:        { label: 'in progress',             cls: 'rna' },
  finished:           { label: 'finished',                cls: 'done' },
  failed:             { label: 'failed',                  cls: 'error' },
  queued_resynthesis: { label: 'queued for resynthesis',  cls: 'mixed' },
}

// ── component ─────────────────────────────────────────────────────────────────

const SCALE_OPTIONS = [25, 100, 200, 1000]

function parseNotes(notes) {
  const purification = (notes || '').match(/Purification:\s*([^,]+)/i)?.[1]?.trim() || 'Desalted'
  const formulation  = (notes || '').match(/Formulation:\s*([^,]+)/i)?.[1]?.trim() || 'Dry'
  return { purification, formulation }
}

// ── CSV generation ────────────────────────────────────────────────────────────

// Replace /5Name/ /iName/ /3Name/ (and aliases) with assigned slot or AmMC6 (NHS ester route)
function applyModPositions(seq, modPositions, modCatalog, modDelivery) {
  let result = seq
  for (const [canonicalName, pos] of Object.entries(modPositions)) {
    const delivery = modDelivery?.[canonicalName] ?? 'amidite'
    if (delivery === 'amidite' && pos == null) continue
    const mod  = modCatalog.find(m => m.canonical_name === canonicalName)
    const names = [canonicalName, ...(mod?.aliases ? String(mod.aliases).split(',').map(a => a.trim()).filter(Boolean) : [])]
    for (const name of names) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (delivery === 'nhs_ester') {
        if (pos == null) continue
        result = result.replace(new RegExp(`\\/5${esc}\\/`, 'g'), String(pos))
        result = result.replace(new RegExp(`\\/3${esc}\\/`, 'g'), String(pos))
        // internal positions not yet supported for NHS ester — left unchanged
      } else {
        result = result.replace(new RegExp(`\\/[5i3]?${esc}\\/`, 'g'), String(pos))
      }
    }
  }
  return result
}

function generateCsv(plate, dmtDefault, dmtOverrides, modPositions, modCatalog, modDelivery) {
  const header = "Sequence 5' - 3',DMT ON or DMT OFF,Name,Secondary Name,Purification,Formulation,Order#,Contact,Institute,,,nt"
  // Column-major order: A1,B1…H1, A2,B2…H2, … A12…H12 — all 96 positions always emitted
  const positions = COLS.flatMap(c => ROWS.map(r => `${r}${c}`))

  const esc = v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows = positions.map((pos, idx) => {
    const well = plate.wellMap[pos]
    const item = well?.item
    const dmt  = dmtOverrides[pos] ?? dmtDefault
    if (!item) {
      return `,${dmt},,${idx + 1}-${pos},,,,,,,,`
    }
    const rawSeq = (item.annotated_sequence || item.tokens?.bases || '').replace(/\s/g, '')
    const seq    = applyModPositions(rawSeq, modPositions, modCatalog, modDelivery)
    const nt     = item.length_nt ?? (rawSeq.replace(/[^A-Za-z]/g, '').length || '')
    return [
      esc(seq), dmt, esc(item.name), esc(`${idx + 1}-${pos}`),
      esc(item.purification || 'Desalted'), esc(item.formulation || 'Dry'),
      esc(item.order_ref), esc(item.customer_name), esc(item.institute || ''),
      '', '', String(nt),
    ].join(',')
  })

  return [header, ...rows].join('\n')
}

// Build CSV from server-saved run lines (uses synth_sequence already stored in DB)
function generateCsvFromRunLines(lines) {
  const header = "Sequence 5' - 3',DMT ON or DMT OFF,Name,Secondary Name,Purification,Formulation,Order#,Contact,Institute,,,nt"
  const positions = COLS.flatMap(c => ROWS.map(r => `${r}${c}`))
  const posMap = Object.fromEntries(lines.map(l => [l.plate_position, l]))

  const esc = v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows = positions.map((pos, idx) => {
    const line = posMap[pos]
    const dmt = line?.dmt || 'DMT OFF'
    if (!line) return `,${dmt},,${idx + 1}-${pos},,,,,,,,`
    const seq = (line.synth_sequence || line.annotated_sequence || '').replace(/\s/g, '')
    const { purification, formulation } = parseNotes(line.notes)
    return [
      esc(seq), dmt, esc(line.oligo_name), esc(`${idx + 1}-${pos}`),
      esc(purification), esc(formulation),
      esc(line.order_ref), esc(line.customer_name), esc(line.institute || ''),
      '', '', String(line.length_nt || ''),
    ].join(',')
  })

  return [header, ...rows].join('\n')
}

function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
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

export default function SynthesisRunBuilder({ api, onNavigateToRuns, onNavigateToRun }) {
  const [step, setStep]             = useState(1)
  const [runMeta, setRunMeta]       = useState({ synthesizer: 'Dr. Oligo BLP-XLC-5133', operator: '', notes: '', scale: 100 })
  const [orders, setOrders]         = useState([])
  const [details, setDetails]       = useState({})
  const [expanded, setExpanded]     = useState(new Set())
  const [selection, setSelection]   = useState({})
  const [modCatalog, setModCatalog] = useState([])
  const [fillMode, setFillMode]         = useState('cols')
  const [groupMods, setGroupMods]       = useState(false)
  const [groupOrders, setGroupOrders]   = useState(false)
  const [dmtDefault, setDmtDefault]     = useState('DMT OFF')
  const [dmtOverrides, setDmtOverrides] = useState({})
  const [orderFilter, setOrderFilter]   = useState('')
  const [saving, setSaving]         = useState(false)
  const [savedRun, setSavedRun]         = useState(null)   // { run_id, line_count }
  const [savedRunLines, setSavedRunLines] = useState([])    // lines from GET /runs/:id after save
  const [csvDone, setCsvDone]       = useState(false)
  const [startErr, setStartErr]     = useState('')
  const [saveErr, setSaveErr]       = useState('')
  const [csvErr, setCsvErr]         = useState('')
  const [loadErr, setLoadErr]       = useState('')

  // reagents / CPG — populated after save
  const [materialLots, setMaterialLots] = useState([])
  const [modLotIds, setModLotIds]       = useState({})
  const [rForm, setRForm]           = useState(initRForm)
  const [cpgForm, setCpgForm]       = useState(initCpgForm)
  const [fillAll, setFillAll]       = useState('')
  const [carryover, setCarryover]   = useState(null)
  const [rSaving, setRSaving]       = useState(false)
  const [rSaveMsg, setRSaveMsg]     = useState('')
  const [rLocked, setRLocked]       = useState(false)
  const [modPositions, setModPositions] = useState({})   // canonical_name → 1..8
  const [modDelivery, setModDelivery]   = useState({})   // canonical_name → 'amidite' | 'nhs_ester'
  const [nhsEsterMods, setNhsEsterMods] = useState([])   // canonical_names that used NHS ester in saved run
  const [ammc6Form, setAmmc6Form]       = useState({ ...EMPTY_R })
  const [conjForm, setConjForm]         = useState({})   // canonical_name → { reagent_lot, date_conjugated, operator, notes }

  useEffect(() => {
    Promise.all([api.get('/orders'), api.get('/modifications'), api.get('/material-lots')])
      .then(([ords, mods, lots]) => { setOrders(ords); setModCatalog(mods); setMaterialLots(lots) })
      .catch(() => setLoadErr('Failed to load orders'))
  }, [])

  const machineNames = useMemo(
    () => new Set(modCatalog.filter(m => m.machine_position_required).map(m => m.canonical_name)),
    [modCatalog]
  )

  const filteredOrders = useMemo(() => {
    const q = orderFilter.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(o =>
      (o.customer_ref   || '').toLowerCase().includes(q) ||
      (o.customer_name  || '').toLowerCase().includes(q)
    )
  }, [orders, orderFilter])

  // ── order expand ──────────────────────────────────────────────────────────

  async function toggleOrder(id) {
    const next = new Set(expanded)
    if (next.has(id)) { next.delete(id); setExpanded(next); return }
    next.add(id)
    setExpanded(next)
    if (!details[id]) {
      try { setDetails(d => ({ ...d, [id]: null })) // loading state
        const detail = await api.get(`/orders/${id}`)
        setDetails(d => ({ ...d, [id]: detail }))
      } catch { setDetails(d => ({ ...d, [id]: { lines: [] } })) }
    }
  }

  // ── selection helpers ─────────────────────────────────────────────────────

  function makeItem(order, line) {
    const { purification, formulation } = parseNotes(line.notes)
    return {
      order_line_id: line.id, sequence_id: line.sequence_id,
      name: line.oligo_name ?? line.customer_label ?? '?',
      oligo_type: line.oligo_type, annotated_sequence: line.annotated_sequence,
      tokens: line.tokens, order_ref: order.customer_ref,
      customer_name: order.customer_name ?? '',
      institute: order.institute ?? '',
      purification,
      formulation,
      length_nt: line.length_nt ?? null,
      copies: 1,
    }
  }

  function lineOn(lid) { return !!selection[lid] }

  function toggleLine(order, line) {
    setSelection(s => {
      const n = { ...s }
      if (n[line.id]) delete n[line.id]
      else n[line.id] = makeItem(order, line)
      return n
    })
  }

  function toggleAll(order) {
    const lines = details[order.id]?.lines ?? []
    const allOn = lines.every(l => lineOn(l.id))
    setSelection(s => {
      const n = { ...s }
      if (allOn) lines.forEach(l => delete n[l.id])
      else lines.forEach(l => { if (!n[l.id]) n[l.id] = makeItem(order, l) })
      return n
    })
  }

  function setCopies(lid, val) {
    const n = Math.max(1, Math.min(96, parseInt(val) || 1))
    setSelection(s => ({ ...s, [lid]: { ...s[lid], copies: n } }))
  }

  function setOrderCopies(order, val) {
    const n = Math.max(1, Math.min(96, parseInt(val) || 1))
    const lines = details[order.id]?.lines ?? []
    setSelection(s => {
      const next = { ...s }
      for (const l of lines)
        if (next[l.id]) next[l.id] = { ...next[l.id], copies: n }
      return next
    })
  }

  // ── plate ─────────────────────────────────────────────────────────────────

  const plate = useMemo(
    () => buildPlate(selection, machineNames, fillMode, groupMods, groupOrders),
    [selection, machineNames, fillMode, groupMods, groupOrders]
  )

  // All unique modification canonical names found in the current plate wells
  // (independent of machine_position_required flag — any mod in a sequence needs a position)
  const allModNames = useMemo(() => {
    const names = new Set()
    for (const well of Object.values(plate.wellMap))
      for (const mod of well.item?.tokens?.modifications ?? [])
        names.add(mod.canonical_name)
    return [...names].sort()
  }, [plate.wellMap])

  // Seed modPositions and modDelivery from allModNames; keep user choices
  useEffect(() => {
    setModPositions(prev => {
      const next = {}
      allModNames.forEach((name, i) => {
        next[name] = (prev[name] != null) ? prev[name] : (i + 1)
      })
      return next
    })
    setModDelivery(prev => {
      const next = {}
      allModNames.forEach(name => { next[name] = prev[name] ?? 'amidite' })
      return next
    })
  }, [allModNames.join(',')])

  const overCapacity = plate.totalUsed > CAPACITY

  // Mods selected as NHS ester that also appear at internal positions in the current plate
  const nhsInternalWarnings = useMemo(() => {
    const warned = new Set()
    for (const well of Object.values(plate.wellMap))
      for (const mod of well.item?.tokens?.modifications ?? [])
        if (modDelivery[mod.canonical_name] === 'nhs_ester' && mod.position_type === 'internal')
          warned.add(mod.canonical_name)
    return warned
  }, [plate.wellMap, modDelivery])

  // ── save + CSV ────────────────────────────────────────────────────────────

  async function saveAndGenerateCsv() {
    setSaving(true); setSaveErr('')
    let result
    // ── Step 1: save run to DB ──────────────────────────────────────────────
    try {
      const lines = Object.values(plate.wellMap)
        .filter(w => w.item)
        .map(w => ({ order_line_id: w.item.order_line_id, plate_position: w.pos, dmt: dmtOverrides[w.pos] ?? dmtDefault }))
      const modMap = Object.entries(modPositions)
        .filter(([, pos]) => pos != null)
        .map(([canonical_name, synth_slot]) => {
          const mod = modCatalog.find(m => m.canonical_name === canonical_name)
          const delivery_method = modDelivery[canonical_name] ?? 'amidite'
          return mod ? { modification_id: mod.id, synth_slot, delivery_method } : null
        }).filter(Boolean)
      result = await api.post('/runs', { ...runMeta, scale_nmol: runMeta.scale, lines, mod_map: modMap })
    } catch (err) {
      setSaveErr(err.response?.data?.error || err.message || 'Save failed')
      setSaving(false)
      return
    }
    setSavedRun(result)

    // ── Step 2: fetch saved run lines, generate & download CSV ─────────────
    let runDetail = null
    try {
      runDetail = await api.get(`/runs/${result.run_id}`)
      const csv = generateCsvFromRunLines(runDetail.lines ?? [])
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      downloadCsv(csv, `RUN ${result.run_id} ${today} ${runMeta.scale}nm.csv`)
    } catch (e) {
      console.error('CSV generation error:', e)
      // Non-fatal when navigating: run was saved; user can re-download from RunDetail
      if (!onNavigateToRun) setCsvErr('CSV generation failed: ' + (e.message || String(e)))
    }

    setSaving(false)

    // ── Navigate to RunDetail (preferred) ──────────────────────────────────
    if (onNavigateToRun) {
      onNavigateToRun(result.run_id)
      return
    }

    // ── Fallback: show inline reagent form (when no navigation handler) ────
    if (runDetail) {
      const nhs = (runDetail.mod_map ?? []).filter(m => m.delivery_method === 'nhs_ester').map(m => m.canonical_name)
      setNhsEsterMods(nhs)
      setSavedRunLines(runDetail.lines ?? [])
      setConjForm(Object.fromEntries(nhs.map(n => [n, { reagent_lot: '', date_conjugated: '', operator: '', notes: '' }])))
    }
    setCsvDone(true)
    try {
      const rd = await api.get(`/runs/${result.run_id}/reagents`)
      const rInit = initRForm()
      for (const row of rd.reagents) {
        if (rInit[row.reagent_type]) rInit[row.reagent_type] = {
          material_lot_id: row.material_lot_id || null,
          lot_number: row.lot_number || '', solvent_lot: row.solvent_lot || '',
          date_replaced: row.date_replaced || '', replaced_by: row.replaced_by || '',
        }
      }
      setRForm(rInit)
      const cf = initCpgForm()
      for (const row of rd.cpg) {
        const colNum = parseInt((row.plate_position || '').slice(1))
        if (!isNaN(colNum) && colNum >= 1 && colNum <= 12 && !cf[colNum]?.material_lot_id) {
          cf[colNum] = { material_lot_id: row.material_lot_id || null, lot_number: row.lot_number || '' }
        }
      }
      setCpgForm(cf)
      const ammc6Row = rd.reagents.find(r => r.reagent_type === 'ammc6')
      if (ammc6Row) setAmmc6Form({
        material_lot_id: ammc6Row.material_lot_id || null,
        lot_number: ammc6Row.lot_number || '', solvent_lot: ammc6Row.solvent_lot || '',
        date_replaced: ammc6Row.date_replaced || '', replaced_by: ammc6Row.replaced_by || '',
      })
      if (rd.conjugation?.length) setConjForm(
        Object.fromEntries(rd.conjugation.map(c => [c.modification_name, {
          reagent_lot: c.reagent_lot || '', date_conjugated: c.date_conjugated || '',
          operator: c.operator || '', notes: c.notes || '',
        }]))
      )
      setCarryover(rd.carryover_from)
      setRLocked(rd.reagents.length > 0 && rd.carryover_from === null)
    } catch { /* non-fatal */ }
  }

  async function markRunStarted() {
    setStartErr('')
    try {
      await api.post(`/runs/${savedRun.run_id}/start`, {})
      onNavigateToRuns?.()
    } catch (err) {
      setStartErr(err.response?.data?.error || 'Failed to start run')
    }
  }

  function regenerateCsv() {
    setCsvErr('')
    try {
      const csv = generateCsvFromRunLines(savedRunLines)
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      downloadCsv(csv, `RUN ${savedRun.run_id} ${today} ${runMeta.scale}nm.csv`)
    } catch (e) {
      console.error('regenerateCsv error:', e)
      setCsvErr('CSV error: ' + (e.message || String(e)))
    }
  }

  function setR(key, field, val) {
    setRForm(f => ({ ...f, [key]: { ...f[key], [field]: val } }))
  }

  async function saveReagents() {
    if (!savedRun) return
    setRSaving(true); setRSaveMsg('')
    try {
      const reagents = REAGENTS.map(r => ({
        reagent_type: r.key,
        material_lot_id: rForm[r.key]?.material_lot_id || null,
        lot_number: rForm[r.key]?.lot_number || null,
        solvent_lot: rForm[r.key]?.solvent_lot || null,
        date_replaced: rForm[r.key]?.date_replaced || null,
        replaced_by: rForm[r.key]?.replaced_by || null,
      }))
      // Expand per-column CPG form entries to per-well plate_position entries
      const cpg = COLS.flatMap(c => {
        const entry = cpgForm[c]
        if (!entry?.material_lot_id) return []
        return ROWS.map(r => ({
          plate_position: `${r}${c}`,
          material_lot_id: entry.material_lot_id,
          lot_number: entry.lot_number || null,
        }))
      })
      const mod_lots = Object.entries(modLotIds)
        .filter(([, id]) => id != null)
        .map(([canonical_name, material_lot_id]) => ({ canonical_name, material_lot_id }))
      if (nhsEsterMods.length > 0) {
        reagents.push({
          reagent_type: 'ammc6',
          material_lot_id: ammc6Form.material_lot_id || null,
          lot_number: ammc6Form.lot_number || null,
          solvent_lot: ammc6Form.solvent_lot || null,
          date_replaced: ammc6Form.date_replaced || null,
          replaced_by: ammc6Form.replaced_by || null,
        })
      }
      const conjugation = nhsEsterMods.map(n => ({
        modification_name: n,
        reagent_lot:       conjForm[n]?.reagent_lot       || null,
        date_conjugated:   conjForm[n]?.date_conjugated   || null,
        operator:          conjForm[n]?.operator          || null,
        notes:             conjForm[n]?.notes             || null,
      }))
      await api.put(`/runs/${savedRun.run_id}/reagents`, { reagents, cpg, mod_lots, conjugation })
      setRSaveMsg('Saved')
      setCarryover(null)
      setRLocked(true)
      setTimeout(() => setRSaveMsg(''), 2500)
    } catch { setRSaveMsg('Save failed') }
    finally { setRSaving(false) }
  }

  const ammc6Ready    = nhsEsterMods.length === 0 || ammc6Form.material_lot_id != null
  const conjReady     = nhsEsterMods.length === 0 || nhsEsterMods.every(n => conjForm[n]?.reagent_lot)
  const reagentsReady = REAGENTS.every(r => rForm[r.key]?.material_lot_id != null) && ammc6Ready && conjReady
  // Only require CPG for columns that actually contain sequences
  const activeCpgCols = [...new Set(
    Object.values(plate.wellMap).filter(w => w.item).map(w => parseInt(w.pos.slice(1)))
  )]
  const cpgReady = activeCpgCols.every(c => cpgForm[c]?.material_lot_id != null)

  // ── render ────────────────────────────────────────────────────────────────

  if (loadErr) return <div className="notice error">{loadErr}</div>

  return (
    <div className="srb">
      {/* ── header ── */}
      <div className="section-head">
        <div>
          <h2>Run Setup</h2>
          <p style={{ color: overCapacity ? '#ef4444' : undefined }}>
            {plate.totalUsed} / {CAPACITY} wells used
            {overCapacity ? ` — remove ${plate.totalUsed - CAPACITY}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {step === 2 && !csvDone && <button className="btn-ghost" onClick={() => setStep(1)}>← Back</button>}
          {step === 1 && (
            <button className="btn-primary"
                    disabled={plate.totalUsed === 0 || overCapacity}
                    onClick={() => setStep(2)}>
              Preview plate →
            </button>
          )}
          {step === 2 && !csvDone && (
            <button className="btn-primary" disabled={saving || overCapacity} onClick={saveAndGenerateCsv}>
              {saving ? 'Saving…' : 'Save & Generate CSV'}
            </button>
          )}
        </div>
      </div>

      {saveErr && <div className="notice error" style={{ marginBottom: 16 }}>{saveErr}</div>}

      {/* ── post-CSV banner ── */}
      {csvDone && savedRun && (
        <div className="srb-csv-done">
          <div className="notice success" style={{ marginBottom: 12 }}>
            Run #{savedRun.run_id} saved — {savedRun.line_count} wells.
            {!csvErr && ' CSV downloaded.'}
          </div>
          {csvErr && <div className="notice error" style={{ marginBottom: 12 }}>{csvErr}</div>}
          {startErr && <div className="notice error" style={{ marginBottom: 12 }}>{startErr}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-primary"
                    disabled={!reagentsReady || !cpgReady}
                    title={!reagentsReady || !cpgReady ? 'Fill in all reagent lots and CPG first' : ''}
                    onClick={markRunStarted}>
              ▶ Mark run started
            </button>
            {(!reagentsReady || !cpgReady) && (
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Fill reagents &amp; CPG below first</span>
            )}
            <button className="btn-ghost" onClick={regenerateCsv}>↓ Re-download CSV</button>
            <button className="btn-ghost" onClick={() => { setSavedRun(null); setSavedRunLines([]); setCsvDone(false); setSelection({}); setNhsEsterMods([]); setAmmc6Form({ ...EMPTY_R }); setConjForm({}); setStep(1) }}>
              + Build another run
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP 1 ══ */}
      {step === 1 && (
        <div>
          {/* Run metadata */}
          <div className="srb-meta">
            <div className="field">
              <label>Synthesizer</label>
              <input value={runMeta.synthesizer} readOnly
                     style={{ background: 'var(--surface)', cursor: 'default', color: 'var(--text-dim)' }} />
            </div>
            <div className="field">
              <label>Operator</label>
              <input value={runMeta.operator} placeholder="Name"
                     onChange={e => setRunMeta(m => ({ ...m, operator: e.target.value }))} />
            </div>
            <div className="field">
              <label>Scale</label>
              <div className="srb-scale-group">
                {SCALE_OPTIONS.map(s => (
                  <button key={s}
                          className={`srb-opt-btn ${runMeta.scale === s ? 'active' : ''}`}
                          onClick={() => setRunMeta(m => ({ ...m, scale: s }))}>
                    {s} nmol
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Order filter */}
          <div className="srb-order-filter">
            <input className="filter-input" placeholder="Filter orders by # or customer…"
                   value={orderFilter} onChange={e => setOrderFilter(e.target.value)} />
          </div>

          {/* Orders */}
          {filteredOrders.length === 0
            ? <div className="notice warn">
                {orders.length === 0 ? 'No orders yet. Import an order first.' : 'No orders match filter.'}
              </div>
            : filteredOrders.map(order => {
                const isOpen = expanded.has(order.id)
                const detail = details[order.id]
                const lines  = detail?.lines ?? []
                const selectedLines = lines.filter(l => lineOn(l.id))
                const allOn  = lines.length > 0 && lines.every(l => lineOn(l.id))
                const someOn = lines.some(l => lineOn(l.id))

                // Representative copies value for order-level control
                const orderCopiesVal = selectedLines.length > 0
                  ? selection[selectedLines[0].id]?.copies ?? 1
                  : 1

                return (
                  <div key={order.id} className="srb-order">
                    <div className="srb-order-hdr" onClick={() => toggleOrder(order.id)}>
                      <span className="srb-chevron">{isOpen ? '▾' : '▸'}</span>
                      <span className="mono srb-ref">#{order.customer_ref ?? '—'}</span>
                      <span className="srb-cust">{order.customer_name ?? '—'}</span>
                      <span className="mono srb-date">{order.order_date ?? ''}</span>
                      <span className="srb-count">{order.line_count} oligos
                        {someOn ? ` · ${selectedLines.length} selected` : ''}
                      </span>
                      {order.status && (
                        <span className={`tag ${statusClass(order.status)}`} style={{ marginLeft: 'auto', marginRight: 8, flexShrink: 0 }}>
                          {order.status.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>

                    {isOpen && (
                      <div className="srb-lines">
                        {!detail
                          ? <div className="srb-loading">Loading…</div>
                          : (
                            <>
                              {/* Controls above the table */}
                              <div className="srb-line-controls">
                                <button
                                  className={`btn-ghost srb-selall ${allOn ? 'active' : ''}`}
                                  onClick={() => toggleAll(order)}>
                                  {allOn ? 'Deselect all' : someOn ? 'Select rest' : 'Select all'}
                                </button>
                                {someOn && (
                                  <label className="srb-order-copies">
                                    Set all copies to
                                    <input type="number" min={1} max={96}
                                           className="srb-copies"
                                           value={orderCopiesVal}
                                           onChange={e => setOrderCopies(order, e.target.value)} />
                                  </label>
                                )}
                              </div>

                              {/* Oligo table */}
                              <table className="srb-table">
                                <thead>
                                  <tr>
                                    <th style={{ width: 32 }} />
                                    <th>#</th>
                                    <th>Name</th>
                                    <th>Type</th>
                                    <th>Sequence</th>
                                    <th style={{ width: 72 }}>Copies</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lines.map(line => {
                                    const on = lineOn(line.id)
                                    return (
                                      <tr key={line.id} className={on ? 'srb-row-on' : ''}>
                                        <td>
                                          <input type="checkbox" checked={on}
                                                 onChange={() => toggleLine(order, line)} />
                                        </td>
                                        <td className="mono">{line.line_number}</td>
                                        <td className="primary">
                                          {line.oligo_name ?? line.customer_label ?? '—'}
                                          {line.line_status && LINE_STATUS[line.line_status] && (
                                            <span className={`tag ${LINE_STATUS[line.line_status].cls}`}
                                                  style={{ marginLeft: 6, verticalAlign: 'middle', fontSize: 10 }}>
                                              {LINE_STATUS[line.line_status].label}
                                            </span>
                                          )}
                                        </td>
                                        <td>
                                          <span className={`tag ${line.oligo_type === 'DNA' ? '' : 'rna'}`}>
                                            {line.oligo_type ?? '—'}
                                          </span>
                                        </td>
                                        <td className="mono srb-seq">{line.annotated_sequence}</td>
                                        <td>
                                          {on && (
                                            <input type="number" min={1} max={96}
                                                   className="srb-copies"
                                                   value={selection[line.id]?.copies ?? 1}
                                                   onChange={e => setCopies(line.id, e.target.value)} />
                                          )}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </>
                          )
                        }
                      </div>
                    )}
                  </div>
                )
              })
          }
        </div>
      )}

      {/* ══ STEP 2 ══ */}
      {step === 2 && (
        <div>
          {/* Options — hidden once plate is confirmed */}
          {!csvDone && (
            <div className="srb-opts">
              <div className="srb-opt-group">
                <span className="srb-opt-label">Fill order</span>
                {[['rows','By rows →'],['cols','By columns ↓']].map(([v, lbl]) => (
                  <button key={v}
                          className={`srb-opt-btn ${fillMode === v ? 'active' : ''}`}
                          onClick={() => setFillMode(v)}>
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="srb-opt-group">
                <span className="srb-opt-label">DMT (global)</span>
                {['DMT OFF', 'DMT ON'].map(v => (
                  <button key={v}
                          className={`srb-opt-btn ${dmtDefault === v ? 'active' : ''}`}
                          onClick={() => setDmtDefault(v)}>
                    {v}
                  </button>
                ))}
              </div>
              <div style={{ flexBasis: '100%', height: 0 }} />
              <label className="srb-checkbox">
                <input type="checkbox" checked={groupMods}
                       onChange={e => setGroupMods(e.target.checked)} />
                Group modifications (modified rows on top, primers below)
              </label>
              <label className="srb-checkbox">
                <input type="checkbox" checked={groupOrders}
                       onChange={e => setGroupOrders(e.target.checked)} />
                Group by order (keep each order's oligos together)
              </label>

            </div>
          )}

          {/* Legend (colors only) */}
          {plate.legend.length > 0 && (
            <div className="srb-legend">
              {plate.legend.map((e, i) => (
                <div key={i} className="srb-legend-row">
                  <span className="srb-dot" style={{ background: e.color }} />
                  <span className="srb-legend-label">{e.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Plate + ASSIGN SPECIALS side panel */}
          <div className="srb-plate-area">
            <div className="srb-plate-scroll" style={{ marginBottom: csvDone ? 24 : undefined, flex: 1, minWidth: 0 }}>
            <div className="srb-plate">
              <div className="srb-corner" />
              {COLS.map(c => <div key={`ch${c}`} className="srb-col-hdr">{c}</div>)}
              {ROWS.flatMap(row => [
                <div key={`rh${row}`} className="srb-row-hdr">{row}</div>,
                ...COLS.map(col => {
                  const pos  = `${row}${col}`
                  const well = plate.wellMap[pos]
                  const item = well?.item
                  return (
                    <div key={pos}
                         className={`srb-well ${item ? 'srb-well-filled' : 'srb-well-empty'}`}
                         style={item
                           ? (dmtOverrides[pos] ?? dmtDefault) === 'DMT ON'
                             ? { background: '#f9731628', borderColor: '#f97316' }
                             : { background: well.color + '28', borderColor: well.color }
                           : {}}
                         title={item
                           ? `${pos}: ${item.name}${item.copies > 1 ? ` ×${item.copyNum}/${item.copies}` : ''}\n${item.annotated_sequence ?? ''}`
                           : pos}>
                      <span className="srb-well-pos">{pos}</span>
                      {item && (
                        <>
                          <span className="srb-well-name">{item.name}</span>
                          {item.copies > 1 &&
                            <span className="srb-well-copy">×{item.copyNum}</span>}
                          <button
                            className="srb-dmt-chip"
                            style={(dmtOverrides[pos] ?? dmtDefault) === 'DMT ON'
                              ? { background: '#f9731628', borderColor: '#f97316', color: '#f97316' }
                              : {}}
                            onClick={e => {
                              e.stopPropagation()
                              const cur = dmtOverrides[pos] ?? dmtDefault
                              setDmtOverrides(ov => ({ ...ov, [pos]: cur === 'DMT ON' ? 'DMT OFF' : 'DMT ON' }))
                            }}>
                            {dmtOverrides[pos] ?? dmtDefault}
                          </button>
                        </>
                      )}
                    </div>
                  )
                })
              ])}
            </div>
          </div>
          {/* ASSIGN SPECIALS panel */}
          {allModNames.length > 0 && (
            <div className="srb-specials-panel">
              <h3 className="srb-specials-title">Assign Specials</h3>
              {allModNames.length > 8 && (
                <div className="srb-specials-warning">
                  ⚠ {allModNames.length} modifications — only 8 machine positions available.
                </div>
              )}
              {allModNames.map(name => {
                const delivery = modDelivery[name] ?? 'amidite'
                return (
                  <div key={name} className="srb-special-row">
                    <span className="srb-special-name">{name}</span>
                    <div className="srb-special-delivery">
                      <button
                        className={`srb-opt-btn${delivery === 'amidite' ? ' active' : ''}`}
                        onClick={() => setModDelivery(d => ({ ...d, [name]: 'amidite' }))}>
                        Amidite
                      </button>
                      <button
                        className={`srb-opt-btn${delivery === 'nhs_ester' ? ' active' : ''}`}
                        onClick={() => setModDelivery(d => ({ ...d, [name]: 'nhs_ester' }))}>
                        NHS Ester
                      </button>
                    </div>
                    {delivery === 'nhs_ester' && (
                      <div className="srb-nhs-label">
                        → AmMC6 slot
                        {nhsInternalWarnings.has(name) && (
                          <span className="srb-nhs-warn"> ⚠ internal pos unchanged</span>
                        )}
                      </div>
                    )}
                    <div className="srb-special-list">
                      {[1,2,3,4,5,6,7,8].map(n => (
                        <div key={n}
                             className={`srb-special-item${modPositions[name] === n ? ' srb-special-item-active' : ''}`}
                             onClick={() => setModPositions(p => ({ ...p, [name]: n }))}>
                          {n}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          </div>{/* end srb-plate-area */}

          {/* ── Reagent Info & CPG — shown after plate is saved ── */}
          {csvDone && savedRun && (
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
                        {rSaveMsg && <span style={{ fontSize: 13, color: rSaveMsg === 'Saved' ? 'var(--accent)' : '#ef4444' }}>{rSaveMsg}</span>}
                        <button className="btn-primary" disabled={rSaving} onClick={saveReagents}>
                          {rSaving ? 'Saving…' : 'Commit reagents & CPG'}
                        </button>
                      </>
                  }
                </div>
              </div>

              {rLocked ? (
                <>
                  <table className="rl-rtable">
                    <thead>
                      <tr><th>Reagent</th><th>Lot #</th><th>Solvent lot</th><th>Date replaced</th><th>Replaced by</th></tr>
                    </thead>
                    <tbody>
                      {REAGENTS.map(r => {
                        const v = rForm[r.key] || EMPTY_R
                        return (
                          <tr key={r.key}>
                            <td className="rl-reagent-label">{r.label}</td>
                            <td className="mono">{v.lot_number || '—'}</td>
                            <td className="mono">{r.amidite ? (v.solvent_lot || '—') : <span className="rl-na">—</span>}</td>
                            <td className="mono">{v.date_replaced || '—'}</td>
                            <td>{v.replaced_by || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                    <h3>CPG (per column)</h3>
                  </div>
                  <div className="rl-cpg-grid">
                    {COLS.map(c => (
                      <div key={c} className="rl-cpg-col">
                        <div className="rl-cpg-label">Col {c}</div>
                        <div className="rl-cpg-val mono">{cpgForm[c]?.lot_number || '—'}</div>
                      </div>
                    ))}
                  </div>
                  {Object.keys(plate.slotFor).filter(cn => !nhsEsterMods.includes(cn)).length > 0 && (
                    <>
                      <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                        <h3>Modification Lots</h3>
                      </div>
                      <table className="rl-rtable" style={{ margin: '0 14px 14px' }}>
                        <thead><tr><th>Modification</th><th>Lot #</th><th>Provider</th><th>MW addition (Da)</th></tr></thead>
                        <tbody>
                          {Object.entries(plate.slotFor).filter(([cn]) => !nhsEsterMods.includes(cn)).map(([cn]) => {
                            const lot = materialLots.find(l => l.id === modLotIds[cn])
                            return (
                              <tr key={cn}>
                                <td className="rl-reagent-label">{cn}</td>
                                <td className="mono">{lot?.lot_number || '—'}</td>
                                <td>{lot?.provider || '—'}</td>
                                <td className="mono">{lot?.mw_addition != null ? `+${lot.mw_addition}` : '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                  {nhsEsterMods.length > 0 && (
                    <>
                      <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                        <h3>AmMC6 (NHS Ester Amidite)</h3>
                      </div>
                      <table className="rl-rtable" style={{ margin: '0 14px 14px' }}>
                        <thead><tr><th>Lot #</th><th>Solvent lot</th><th>Date replaced</th><th>Replaced by</th></tr></thead>
                        <tbody>
                          <tr>
                            <td className="mono">{ammc6Form.lot_number || '—'}</td>
                            <td className="mono">{ammc6Form.solvent_lot || '—'}</td>
                            <td className="mono">{ammc6Form.date_replaced || '—'}</td>
                            <td>{ammc6Form.replaced_by || '—'}</td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                        <h3>NHS Ester Conjugation</h3>
                      </div>
                      <table className="rl-rtable" style={{ margin: '0 14px 14px' }}>
                        <thead><tr><th>Modification</th><th>NHS ester lot</th><th>Date conjugated</th><th>Operator</th><th>Notes</th></tr></thead>
                        <tbody>
                          {nhsEsterMods.map(n => (
                            <tr key={n}>
                              <td className="rl-reagent-label">{n}</td>
                              <td className="mono">{conjForm[n]?.reagent_lot || '—'}</td>
                              <td className="mono">{conjForm[n]?.date_conjugated || '—'}</td>
                              <td>{conjForm[n]?.operator || '—'}</td>
                              <td>{conjForm[n]?.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              ) : (
                <>
                  <table className="rl-rtable">
                    <thead>
                      <tr><th>Reagent</th><th>Lot #</th><th>Solvent lot</th><th>Date replaced</th><th>Replaced by</th></tr>
                    </thead>
                    <tbody>
                      {REAGENTS.map(r => {
                        const v = rForm[r.key] || EMPTY_R
                        const cn = REAGENT_CANONICAL[r.key]
                        const available = materialLots.filter(l =>
                          l.material_type === (r.amidite ? 'amidite' : 'reagent') && l.canonical_name === cn
                        )
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
                            <td>{r.amidite
                              ? <input className="rl-input" value={v.solvent_lot} onChange={e => setR(r.key, 'solvent_lot', e.target.value)} />
                              : <span className="rl-na">—</span>}
                            </td>
                            <td><input type="date" className="rl-input rl-date" value={v.date_replaced} onChange={e => setR(r.key, 'date_replaced', e.target.value)} /></td>
                            <td><input className="rl-input" value={v.replaced_by} onChange={e => setR(r.key, 'replaced_by', e.target.value)} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                    <h3>CPG (per column)</h3>
                    <div className="rl-fillaAll">
                      <select className="rl-input" value={fillAll} onChange={e => setFillAll(e.target.value)}>
                        <option value="">Select lot to fill all columns…</option>
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
                          COLS.forEach(c => { n[c] = { material_lot_id: id, lot_number: lot.lot_number } })
                          return n
                        })
                      }}>Fill all</button>
                    </div>
                  </div>
                  <div className="rl-cpg-grid">
                    {COLS.map(c => {
                      const cpgLots = materialLots.filter(l => l.material_type === 'cpg')
                      return (
                        <div key={c} className="rl-cpg-col">
                          <div className="rl-cpg-label">Col {c}</div>
                          <select className="rl-input rl-cpg-input"
                                  value={cpgForm[c]?.material_lot_id ?? ''}
                                  onChange={e => {
                                    const id = e.target.value ? parseInt(e.target.value) : null
                                    const lot = materialLots.find(l => l.id === id)
                                    setCpgForm(f => ({ ...f, [c]: { material_lot_id: id, lot_number: lot ? lot.lot_number : '' } }))
                                  }}>
                            <option value="">—</option>
                            {cpgLots.map(l => (
                              <option key={l.id} value={l.id}>{l.lot_number}{l.provider ? ` (${l.provider})` : ''}</option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                  {Object.keys(plate.slotFor).filter(cn => !nhsEsterMods.includes(cn)).length > 0 && (
                    <>
                      <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                        <h3>Modification Lots</h3>
                      </div>
                      <div style={{ padding: '0 14px 14px' }}>
                        <table className="rl-rtable">
                          <thead><tr><th>Modification</th><th>Lot</th></tr></thead>
                          <tbody>
                            {Object.entries(plate.slotFor).filter(([cn]) => !nhsEsterMods.includes(cn)).map(([cn]) => {
                              const available = materialLots.filter(l =>
                                l.material_type === 'amidite' && l.canonical_name === cn
                              )
                              return (
                                <tr key={cn}>
                                  <td className="rl-reagent-label">{cn}</td>
                                  <td>
                                    <select className="rl-input rl-select"
                                            value={modLotIds[cn] ?? ''}
                                            onChange={e => {
                                              const id = e.target.value ? parseInt(e.target.value) : null
                                              setModLotIds(m => ({ ...m, [cn]: id }))
                                            }}>
                                      <option value="">— select lot —</option>
                                      {available.map(l => (
                                        <option key={l.id} value={l.id}>
                                          {l.lot_number}{l.provider ? ` (${l.provider})` : ''}{l.mw_addition != null ? ` +${l.mw_addition} Da` : ''}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {nhsEsterMods.length > 0 && (
                    <>
                      <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                        <h3>AmMC6 (NHS Ester Amidite)</h3>
                      </div>
                      <table className="rl-rtable" style={{ margin: '0 14px 14px' }}>
                        <thead>
                          <tr><th>Lot #</th><th>Solvent lot</th><th>Date replaced</th><th>Replaced by</th></tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>
                              <select className="rl-input rl-select"
                                      value={ammc6Form.material_lot_id ?? ''}
                                      onChange={e => {
                                        const id = e.target.value ? parseInt(e.target.value) : null
                                        const lot = materialLots.find(l => l.id === id)
                                        setAmmc6Form(f => ({ ...f, material_lot_id: id, lot_number: lot?.lot_number ?? '' }))
                                      }}>
                                <option value="">— select lot —</option>
                                {materialLots.filter(l => l.material_type === 'amidite' && l.canonical_name === 'AmMC6').map(l => (
                                  <option key={l.id} value={l.id}>{l.lot_number}{l.provider ? ` (${l.provider})` : ''}</option>
                                ))}
                              </select>
                            </td>
                            <td><input className="rl-input" value={ammc6Form.solvent_lot}
                                       onChange={e => setAmmc6Form(f => ({ ...f, solvent_lot: e.target.value }))} /></td>
                            <td><input type="date" className="rl-input rl-date" value={ammc6Form.date_replaced}
                                       onChange={e => setAmmc6Form(f => ({ ...f, date_replaced: e.target.value }))} /></td>
                            <td><input className="rl-input" value={ammc6Form.replaced_by}
                                       onChange={e => setAmmc6Form(f => ({ ...f, replaced_by: e.target.value }))} /></td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="rl-section-hdr" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
                        <h3>NHS Ester Conjugation</h3>
                      </div>
                      <div style={{ padding: '0 14px 14px' }}>
                        <table className="rl-rtable">
                          <thead>
                            <tr><th>Modification</th><th>NHS ester lot</th><th>Date conjugated</th><th>Operator</th><th>Notes</th></tr>
                          </thead>
                          <tbody>
                            {nhsEsterMods.map(n => (
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
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
