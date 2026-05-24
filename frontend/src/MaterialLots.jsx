import { useState, useEffect, useRef } from 'react'

const TYPE_TABS = [
  { key: 'all',     label: 'All' },
  { key: 'amidite', label: 'Amidites' },
  { key: 'reagent', label: 'Reagents' },
  { key: 'cpg',     label: 'CPG' },
]

const REAGENT_CANONICALS = ['wash', 'oxidizer', 'cap_a', 'cap_b', 'activator']

const EMPTY_FORM = {
  material_type: 'amidite', canonical_name: '', catalogue_number: '', lot_number: '',
  manufacturer: '', vendor: '', mw: '', fw: '', received_date: '', expiry_date: '',
}

function fmtNum(v) {
  if (v == null || v === '') return '—'
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function lotToForm(l) {
  return {
    material_type:    l.material_type    || 'amidite',
    canonical_name:   l.canonical_name   || '',
    catalogue_number: l.catalogue_number || '',
    lot_number:       l.lot_number       || '',
    manufacturer:     l.manufacturer     || '',
    vendor:           l.vendor           || '',
    mw:               l.mw  != null ? String(l.mw)  : '',
    fw:               l.fw  != null ? String(l.fw)  : '',
    received_date:    l.received_date    || '',
    expiry_date:      l.expiry_date      || '',
  }
}

function buildBody(form) {
  return {
    ...form,
    mw:               form.mw ? parseFloat(form.mw) : null,
    fw:               form.fw ? parseFloat(form.fw) : null,
    canonical_name:   form.canonical_name.trim()   || null,
    catalogue_number: form.catalogue_number.trim() || null,
    manufacturer:     form.manufacturer.trim()     || null,
    vendor:           form.vendor.trim()           || null,
    received_date:    form.received_date || null,
    expiry_date:      form.expiry_date   || null,
  }
}

function LotForm({ form, setF, onSave, onCancel, saving, saveErr, submitLabel }) {
  return (
    <div style={{
      marginBottom: 20, padding: 20, border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', background: 'var(--surface)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div className="field">
          <label>Type *</label>
          <select className="filter-input" value={form.material_type}
                  onChange={e => setF('material_type', e.target.value)}>
            <option value="amidite">Amidite</option>
            <option value="reagent">Reagent</option>
            <option value="cpg">CPG</option>
          </select>
        </div>

        <div className="field">
          <label>
            {form.material_type === 'amidite' ? 'Base / Modification' :
             form.material_type === 'reagent'  ? 'Reagent type' : 'CPG name'}
          </label>
          {form.material_type === 'reagent' ? (
            <select className="filter-input" value={form.canonical_name}
                    onChange={e => setF('canonical_name', e.target.value)}>
              <option value="">— select —</option>
              {REAGENT_CANONICALS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          ) : (
            <input value={form.canonical_name}
                   placeholder={form.material_type === 'amidite' ? 'e.g. dA, /5Phos/' : 'e.g. standard dT-CPG'}
                   onChange={e => setF('canonical_name', e.target.value)} />
          )}
        </div>

        <div className="field">
          <label>Catalogue #</label>
          <input value={form.catalogue_number} placeholder="e.g. 10-1000-02"
                 onChange={e => setF('catalogue_number', e.target.value)} />
        </div>

        <div className="field">
          <label>Lot number *</label>
          <input value={form.lot_number} placeholder="e.g. ABC12345"
                 onChange={e => setF('lot_number', e.target.value)} />
        </div>

        <div className="field">
          <label>Manufacturer</label>
          <input value={form.manufacturer} placeholder="e.g. Glen Research"
                 onChange={e => setF('manufacturer', e.target.value)} />
        </div>

        <div className="field">
          <label>Vendor</label>
          <input value={form.vendor} placeholder="e.g. Sigma-Aldrich"
                 onChange={e => setF('vendor', e.target.value)} />
        </div>

        <div className="field">
          <label>MW (Da)</label>
          <input type="number" step="0.0001" value={form.mw} placeholder="—"
                 onChange={e => setF('mw', e.target.value)} />
        </div>

        <div className="field">
          <label>FW (g/mol)</label>
          <input type="number" step="0.0001" value={form.fw} placeholder="—"
                 onChange={e => setF('fw', e.target.value)} />
        </div>

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

function RowMenu({ onEdit, onDelete, deleting }) {
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
        style={{ fontSize: 18, padding: '1px 8px', lineHeight: 1, letterSpacing: 1 }}
        disabled={deleting}
        onClick={() => setOpen(o => !o)}
      >
        {deleting ? '…' : '···'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          minWidth: 110, overflow: 'hidden',
        }}>
          <button style={menuItemStyle} onClick={() => { setOpen(false); onEdit() }}>
            Edit
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
  cursor: 'pointer', fontSize: 13,
}

export default function MaterialLots({ api }) {
  const [lots, setLots]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const [showAdd, setShowAdd]   = useState(false)
  const [addForm, setAddForm]   = useState(EMPTY_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addErr, setAddErr]     = useState('')

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm]   = useState(EMPTY_FORM)
  const [editSaving, setEditSaving] = useState(false)
  const [editErr, setEditErr]     = useState('')

  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    api.get('/material-lots')
      .then(setLots)
      .catch(() => setErr('Failed to load material lots'))
      .finally(() => setLoading(false))
  }, [])

  const displayed = typeFilter === 'all' ? lots : lots.filter(l => l.material_type === typeFilter)

  function setAddF(field, val) { setAddForm(f => ({ ...f, [field]: val })) }
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

  return (
    <div>
      {/* ── header ── */}
      <div className="section-head">
        <div>
          <h2>Material Lots</h2>
          <p>{displayed.length} lot{displayed.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={() => { setShowAdd(s => !s); setAddErr(''); setEditingId(null) }}>
          {showAdd ? '✕ Cancel' : '+ Add lot'}
        </button>
      </div>

      {/* ── add form ── */}
      {showAdd && (
        <LotForm
          form={addForm} setF={setAddF}
          onSave={addLot} onCancel={() => setShowAdd(false)}
          saving={addSaving} saveErr={addErr} submitLabel="Save lot"
        />
      )}

      {/* ── edit form ── */}
      {editingId != null && (
        <LotForm
          form={editForm} setF={setEditF}
          onSave={saveEdit} onCancel={() => setEditingId(null)}
          saving={editSaving} saveErr={editErr} submitLabel="Update lot"
        />
      )}

      {/* ── type filter ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {TYPE_TABS.map(t => (
          <button key={t.key}
                  className={`srb-opt-btn ${typeFilter === t.key ? 'active' : ''}`}
                  onClick={() => setTypeFilter(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── table ── */}
      {displayed.length === 0 ? (
        <div className="notice warn">
          {lots.length === 0 ? 'No lots yet. Add your first lot using the button above.' : 'No lots for this type.'}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Type</th><th>Name</th><th>Cat. #</th><th>Lot #</th>
              <th>Manufacturer</th><th>Vendor</th>
              <th>MW (Da)</th><th>FW</th>
              <th>Received</th><th>Expiry</th><th></th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(l => (
              <tr key={l.id} style={editingId === l.id ? { background: 'var(--surface)' } : undefined}>
                <td><span className={`tag ${l.material_type === 'amidite' ? 'rna' : l.material_type === 'cpg' ? 'mixed' : ''}`}>{l.material_type}</span></td>
                <td className="primary">{l.canonical_name || '—'}</td>
                <td className="mono">{l.catalogue_number || '—'}</td>
                <td className="mono">{l.lot_number}</td>
                <td>{l.manufacturer || '—'}</td>
                <td>{l.vendor || '—'}</td>
                <td className="mono">{fmtNum(l.mw)}</td>
                <td className="mono">{fmtNum(l.fw)}</td>
                <td className="mono">{l.received_date || '—'}</td>
                <td className="mono">{l.expiry_date   || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <RowMenu
                    deleting={deleting === l.id}
                    onEdit={() => startEdit(l)}
                    onDelete={() => deleteLot(l.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
