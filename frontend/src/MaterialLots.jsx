import { useState, useEffect, useRef, useMemo } from 'react'

const TYPE_TABS = [
  { key: 'all',     label: 'All' },
  { key: 'amidite', label: 'Amidites' },
  { key: 'reagent', label: 'Reagents' },
  { key: 'cpg',     label: 'CPG' },
  { key: 'nhs',     label: 'NHS' },
]

const REAGENT_CANONICALS = ['wash', 'oxidizer', 'cap_a', 'cap_b', 'activator']

// Standard base amidites (not in modification_catalog)
const BASE_CANONICALS = ['dA', 'dC', 'dG', 'dT', 'rA', 'rC', 'rG', 'rU']

const EMPTY_FORM = {
  material_type: 'amidite', canonical_name: '', name: '', cas_number: '',
  catalogue_number: '', lot_number: '',
  manufacturer: '', vendor: '', mw: '', fw: '', mw_addition: '', received_date: '', expiry_date: '',
}

// Columns that support sorting
const SORT_COLS = [
  'material_type', 'canonical_name', 'name', 'cas_number',
  'catalogue_number', 'lot_number', 'manufacturer', 'vendor',
  'mw', 'fw', 'mw_addition',
]

function fmtNum(v) {
  if (v == null || v === '') return '—'
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function lotToForm(l) {
  return {
    material_type:    l.material_type    || 'amidite',
    canonical_name:   l.canonical_name   || '',
    name:             l.name             || '',
    cas_number:       l.cas_number       || '',
    catalogue_number: l.catalogue_number || '',
    lot_number:       l.lot_number       || '',
    manufacturer:     l.manufacturer     || '',
    vendor:           l.vendor           || '',
    mw:               l.mw          != null ? String(l.mw)          : '',
    fw:               l.fw          != null ? String(l.fw)          : '',
    mw_addition:      l.mw_addition  != null ? String(l.mw_addition) : '',
    received_date:    l.received_date    || '',
    expiry_date:      l.expiry_date      || '',
  }
}

function buildBody(form) {
  return {
    ...form,
    mw:               form.mw          ? parseFloat(form.mw)          : null,
    fw:               form.fw          ? parseFloat(form.fw)          : null,
    mw_addition:      form.mw_addition ? parseFloat(form.mw_addition) : null,
    canonical_name:   form.canonical_name.trim()   || null,
    name:             form.name.trim()             || null,
    cas_number:       form.cas_number.trim()       || null,
    catalogue_number: form.catalogue_number.trim() || null,
    manufacturer:     form.manufacturer.trim()     || null,
    vendor:           form.vendor.trim()           || null,
    received_date:    form.received_date || null,
    expiry_date:      form.expiry_date   || null,
  }
}

function sortRows(rows, key, dir) {
  if (!key) return rows
  return [...rows].sort((a, b) => {
    let va = a[key], vb = b[key]
    const numeric = key === 'mw' || key === 'fw' || key === 'mw_addition'
    if (va == null) va = numeric ? -Infinity : ''
    if (vb == null) vb = numeric ? -Infinity : ''
    if (numeric) {
      va = parseFloat(va) || 0
      vb = parseFloat(vb) || 0
      return dir === 'asc' ? va - vb : vb - va
    }
    va = String(va).toLowerCase()
    vb = String(vb).toLowerCase()
    if (va < vb) return dir === 'asc' ? -1 : 1
    if (va > vb) return dir === 'asc' ? 1 : -1
    return 0
  })
}

// ── LotForm ───────────────────────────────────────────────────────────────────
function LotForm({ form, setF, onSave, onCancel, saving, saveErr, submitLabel, modSuggestions }) {
  const dlId = 'mod-suggest-' + form.material_type

  return (
    <div style={{
      marginBottom: 20, padding: 20, border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', background: 'var(--surface)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>

        {/* ── Type ── */}
        <div className="field">
          <label>Type *</label>
          <select className="filter-input" value={form.material_type}
                  onChange={e => setF('material_type', e.target.value)}>
            <option value="amidite">Amidite</option>
            <option value="reagent">Reagent</option>
            <option value="cpg">CPG</option>
            <option value="nhs">NHS</option>
          </select>
        </div>

        {/* ── Modification / linking key ── */}
        <div className="field">
          <label>
            {form.material_type === 'reagent' ? 'Reagent type'
              : form.material_type === 'nhs'  ? 'Modification'
              : 'Modification'}
          </label>
          {form.material_type === 'reagent' ? (
            <select className="filter-input" value={form.canonical_name}
                    onChange={e => setF('canonical_name', e.target.value)}>
              <option value="">— select —</option>
              {REAGENT_CANONICALS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          ) : (
            <>
              <input
                list={dlId}
                value={form.canonical_name}
                placeholder={
                  form.material_type === 'amidite' ? 'e.g. dA, FAM, /5Phos/'
                    : form.material_type === 'nhs' ? 'e.g. Cy5, Atto 550'
                    : 'e.g. dT-CPG 500 Å'
                }
                onChange={e => setF('canonical_name', e.target.value)}
              />
              {(form.material_type === 'amidite' || form.material_type === 'nhs') && (
                <datalist id={dlId}>
                  {form.material_type === 'amidite' && BASE_CANONICALS.map(n => <option key={n} value={n} />)}
                  {modSuggestions.map(n => <option key={n} value={n} />)}
                </datalist>
              )}
            </>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            {form.material_type === 'nhs'
              ? 'Matches modification name for conjugate MW lookup'
              : 'Used to link this lot to synthesis run slots'}
          </span>
        </div>

        {/* ── Product name ── */}
        <div className="field">
          <label>Name</label>
          <input value={form.name}
                 placeholder="Full vendor product name"
                 onChange={e => setF('name', e.target.value)} />
        </div>

        {/* ── CAS ── */}
        <div className="field">
          <label>CAS #</label>
          <input value={form.cas_number}
                 placeholder="e.g. 123-45-6"
                 onChange={e => setF('cas_number', e.target.value)} />
        </div>

        {/* ── Catalogue # ── */}
        <div className="field">
          <label>Catalogue #</label>
          <input value={form.catalogue_number} placeholder="e.g. 10-1000-02"
                 onChange={e => setF('catalogue_number', e.target.value)} />
        </div>

        {/* ── Lot number ── */}
        <div className="field">
          <label>Lot number *</label>
          <input value={form.lot_number} placeholder="e.g. ABC12345"
                 onChange={e => setF('lot_number', e.target.value)} />
        </div>

        {/* ── Manufacturer ── */}
        <div className="field">
          <label>Manufacturer</label>
          <input value={form.manufacturer} placeholder="e.g. Glen Research"
                 onChange={e => setF('manufacturer', e.target.value)} />
        </div>

        {/* ── Vendor ── */}
        <div className="field">
          <label>Vendor</label>
          <input value={form.vendor} placeholder="e.g. Sigma-Aldrich"
                 onChange={e => setF('vendor', e.target.value)} />
        </div>

        {/* ── MW ── */}
        <div className="field">
          <label>MW (Da)</label>
          <input type="number" step="0.0001" value={form.mw} placeholder="—"
                 onChange={e => setF('mw', e.target.value)} />
        </div>

        {/* ── FW ── */}
        <div className="field">
          <label>FW (g/mol)</label>
          <input type="number" step="0.0001" value={form.fw} placeholder="—"
                 onChange={e => setF('fw', e.target.value)} />
        </div>

        {/* ── MW addition — shown for amidite and nhs ── */}
        {(form.material_type === 'amidite' || form.material_type === 'nhs') && (
          <div className="field">
            <label>MW addition (Da)</label>
            <input type="number" step="0.0001" value={form.mw_addition} placeholder="—"
                   onChange={e => setF('mw_addition', e.target.value)} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              {form.material_type === 'nhs'
                ? 'Net MW added to oligo per conjugation event'
                : 'Net MW added to oligo per coupling'}
            </span>
          </div>
        )}

        {/* ── Dates ── */}
        <div className="field">
          <label>Received</label>
          <input type="date" value={form.received_date}
                 onChange={e => setF('received_date', e.target.value)} />
        </div>

        <div className="field">
          <label>Expiry</label>
          <input type="date" value={form.expiry_date}
                 onChange={e => setF('expiry_date', e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn-primary" disabled={saving || !form.lot_number.trim()} onClick={onSave}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        {saveErr && <span style={{ color: '#ef4444', fontSize: 13 }}>{saveErr}</span>}
      </div>
    </div>
  )
}

// ── SortTh ────────────────────────────────────────────────────────────────────
function SortTh({ col, sortKey, sortDir, onSort, children, style }) {
  const active = sortKey === col
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
        onClick={() => onSort(col)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {children}
        <span style={{
          fontSize: 9,
          color: active ? 'var(--accent)' : 'var(--text-dim)',
          opacity: active ? 1 : 0.45,
        }}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </span>
    </th>
  )
}

// ── RowMenu ───────────────────────────────────────────────────────────────────
function RowMenu({ lot, onEdit, onToggleStock, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn-ghost"
        style={{ fontSize: 16, padding: '2px 8px', lineHeight: 1 }}
        onClick={() => setOpen(o => !o)}
      >
        ⋮
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          minWidth: 150, overflow: 'hidden',
        }}>
          <button style={menuItemStyle} onClick={() => { setOpen(false); onEdit() }}>
            Edit
          </button>
          <button style={menuItemStyle} onClick={() => { setOpen(false); onToggleStock() }}>
            {lot.out_of_stock ? 'Back in stock' : 'Mark out of stock'}
          </button>
          <button style={{ ...menuItemStyle, color: '#ef4444' }} onClick={() => { setOpen(false); onDelete() }}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

const menuItemStyle = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 14px', border: 'none', background: 'none',
  cursor: 'pointer', fontSize: 13, color: 'inherit',
}

// ── MaterialLots ──────────────────────────────────────────────────────────────
export default function MaterialLots({ api }) {
  const [lots, setLots]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [err, setErr]               = useState('')
  const [modSuggestions, setModSuggestions] = useState([])

  // filters
  const [typeFilter, setTypeFilter]           = useState('all')
  const [search, setSearch]                   = useState('')
  const [showOutOfStock, setShowOutOfStock]   = useState(false)

  // sort
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  // add form
  const [showAdd, setShowAdd]     = useState(false)
  const [addForm, setAddForm]     = useState(EMPTY_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addErr, setAddErr]       = useState('')

  // edit form
  const [editingId, setEditingId]   = useState(null)
  const [editForm, setEditForm]     = useState(EMPTY_FORM)
  const [editSaving, setEditSaving] = useState(false)
  const [editErr, setEditErr]       = useState('')

  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    Promise.all([
      api.get('/material-lots'),
      api.get('/modifications'),
    ]).then(([lotsData, mods]) => {
      setLots(lotsData)
      setModSuggestions(mods.map(m => m.canonical_name).sort())
    }).catch(() => setErr('Failed to load material lots'))
      .finally(() => setLoading(false))
  }, [])

  // ── derived display list ──────────────────────────────────────────────────
  const displayed = useMemo(() => {
    let rows = lots

    // type filter
    if (typeFilter !== 'all') rows = rows.filter(l => l.material_type === typeFilter)

    // out-of-stock filter
    if (!showOutOfStock) rows = rows.filter(l => !l.out_of_stock)

    // text search
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(l =>
        [l.canonical_name, l.name, l.cas_number, l.catalogue_number,
         l.lot_number, l.manufacturer, l.vendor]
          .some(v => v && String(v).toLowerCase().includes(q))
      )
    }

    // sort
    rows = sortRows(rows, sortKey, sortDir)

    return rows
  }, [lots, typeFilter, showOutOfStock, search, sortKey, sortDir])

  const outOfStockCount = useMemo(
    () => lots.filter(l => l.out_of_stock).length,
    [lots]
  )

  function handleSort(col) {
    if (!SORT_COLS.includes(col)) return
    if (sortKey === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(col)
      setSortDir('asc')
    }
  }

  function setAddF(field, val)  { setAddForm(f => ({ ...f, [field]: val })) }
  function setEditF(field, val) { setEditForm(f => ({ ...f, [field]: val })) }

  async function addLot() {
    if (!addForm.lot_number.trim()) return
    setAddSaving(true); setAddErr('')
    try {
      const newLot = await api.post('/material-lots', buildBody(addForm))
      setLots(ls => [newLot, ...ls])
      setAddForm(EMPTY_FORM)
      setShowAdd(false)
    } catch { setAddErr('Save failed') }
    finally { setAddSaving(false) }
  }

  function startEdit(lot) {
    setEditingId(lot.id)
    setEditForm(lotToForm(lot))
    setEditErr('')
    setShowAdd(false)
  }

  async function saveEdit() {
    if (!editForm.lot_number.trim()) return
    setEditSaving(true); setEditErr('')
    try {
      const updated = await api.put(`/material-lots/${editingId}`, buildBody(editForm))
      setLots(ls => ls.map(l => l.id === editingId ? updated : l))
      setEditingId(null)
    } catch { setEditErr('Save failed') }
    finally { setEditSaving(false) }
  }

  async function toggleStock(lot) {
    try {
      const res = await api.patch(`/material-lots/${lot.id}/stock`, { out_of_stock: !lot.out_of_stock })
      setLots(ls => ls.map(l => l.id === lot.id ? { ...l, out_of_stock: res.out_of_stock } : l))
    } catch { setErr('Failed to update stock status') }
  }

  async function deleteLot(id) {
    setDeleting(id)
    try {
      await api.del(`/material-lots/${id}`)
      setLots(ls => ls.filter(l => l.id !== id))
    } catch { setErr('Delete failed') }
    finally { setDeleting(null) }
  }

  if (loading) return <div className="notice">Loading…</div>
  if (err)     return <div className="notice error">{err}</div>

  const thProps = { sortKey, sortDir, onSort: handleSort }

  return (
    <div>
      {/* ── header ── */}
      <div className="section-head">
        <div>
          <h2>Material Lots</h2>
          <p>
            {displayed.length} lot{displayed.length !== 1 ? 's' : ''}
            {!showOutOfStock && outOfStockCount > 0 && (
              <span style={{ marginLeft: 6, color: 'var(--text-dim)', fontSize: 12 }}>
                · {outOfStockCount} out of stock hidden
              </span>
            )}
          </p>
        </div>
        <button className="btn-primary" onClick={() => { setShowAdd(s => !s); setAddErr(''); setEditingId(null) }}>
          {showAdd ? '✕ Cancel' : '+ Add lot'}
        </button>
      </div>

      {/* ── add form ── */}
      {showAdd && (
        <LotForm
          form={addForm} setF={setAddF} modSuggestions={modSuggestions}
          onSave={addLot} onCancel={() => setShowAdd(false)}
          saving={addSaving} saveErr={addErr} submitLabel="Save lot"
        />
      )}

      {/* ── edit form ── */}
      {editingId != null && (
        <LotForm
          form={editForm} setF={setEditF} modSuggestions={modSuggestions}
          onSave={saveEdit} onCancel={() => setEditingId(null)}
          saving={editSaving} saveErr={editErr} submitLabel="Update lot"
        />
      )}

      {/* ── filter bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>

        {/* type tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {TYPE_TABS.map(t => (
            <button key={t.key}
                    className={`srb-opt-btn ${typeFilter === t.key ? 'active' : ''}`}
                    onClick={() => setTypeFilter(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* text search */}
        <input
          className="filter-input"
          style={{ minWidth: 200, flex: '1 1 200px', maxWidth: 320 }}
          placeholder="Search name, lot, modification, vendor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* out-of-stock toggle */}
        <button
          className={`srb-opt-btn ${showOutOfStock ? 'active' : ''}`}
          onClick={() => setShowOutOfStock(s => !s)}
          title={showOutOfStock ? 'Hide out-of-stock lots' : 'Show out-of-stock lots'}
        >
          {showOutOfStock ? '● Show all' : '○ In stock only'}
        </button>
      </div>

      {/* ── table ── */}
      {displayed.length === 0 ? (
        <div className="notice warn">
          {lots.length === 0
            ? 'No lots yet. Add your first lot using the button above.'
            : 'No lots match the current filters.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <SortTh col="material_type"    {...thProps}>Type</SortTh>
                <SortTh col="canonical_name"   {...thProps}>Modification</SortTh>
                <SortTh col="name"             {...thProps}>Name</SortTh>
                <SortTh col="cas_number"       {...thProps}>CAS</SortTh>
                <SortTh col="catalogue_number" {...thProps}>Cat. #</SortTh>
                <SortTh col="lot_number"       {...thProps}>Lot #</SortTh>
                <SortTh col="manufacturer"     {...thProps}>Manufacturer</SortTh>
                <SortTh col="vendor"           {...thProps}>Vendor</SortTh>
                <SortTh col="mw"               {...thProps}>MW (Da)</SortTh>
                <SortTh col="fw"               {...thProps}>FW</SortTh>
                <SortTh col="mw_addition"      {...thProps}>Conj. FW</SortTh>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(l => (
                <tr key={l.id}
                    style={{
                      opacity: l.out_of_stock ? 0.45 : 1,
                      background: editingId === l.id ? 'var(--surface)' : undefined,
                    }}>
                  <td>
                    <span className={`tag ${
                      l.material_type === 'amidite' ? 'rna'
                        : l.material_type === 'cpg'  ? 'mixed'
                        : l.material_type === 'nhs'  ? 'dna'
                        : ''}`}>
                      {l.material_type}
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--accent)', fontSize: 12 }}>
                    {l.canonical_name || '—'}
                  </td>
                  <td className="primary" style={{ textDecoration: l.out_of_stock ? 'line-through' : 'none' }}>
                    {l.name || '—'}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{l.cas_number || '—'}</td>
                  <td className="mono">{l.catalogue_number || '—'}</td>
                  <td className="mono">{l.lot_number}</td>
                  <td>{l.manufacturer || '—'}</td>
                  <td>{l.vendor || '—'}</td>
                  <td className="mono">{fmtNum(l.mw)}</td>
                  <td className="mono">{fmtNum(l.fw)}</td>
                  <td className="mono">{fmtNum(l.mw_addition)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <RowMenu
                      lot={l}
                      onEdit={() => startEdit(l)}
                      onToggleStock={() => toggleStock(l)}
                      onDelete={() => deleteLot(l.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
