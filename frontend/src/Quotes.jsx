import { useState, useEffect } from 'react'
import './Quotes.css'

const VAT_RATE      = 0.18
const PRICE_PER_NT  = 0.7
const SCALE_OPTIONS = [25, 50, 100, 200, 1000]
const PURIF_OPTIONS = ['Standard Desalt', 'HPLC', 'PAGE', 'RNase-free HPLC']
const STATUS_OPTIONS = ['draft', 'sent', 'accepted', 'rejected']

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseTsv(raw) {
  const lines = raw.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { oligos: null, error: 'Need at least a header row and one data row.' }
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase())
  const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('primer') || h.includes('oligo') || h.includes('id'))
  const seqIdx  = headers.findIndex(h => h.includes('seq'))
  if (nameIdx === -1) return { oligos: null, error: 'Cannot find Name column.' }
  if (seqIdx  === -1) return { oligos: null, error: 'Cannot find Sequence column.' }
  const oligos = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t').map(c => c.trim())
    const name = cols[nameIdx] || ''
    const seq  = (cols[seqIdx] || '').replace(/\s/g, '').toUpperCase()
    if (!name && !seq) continue
    if (!name) return { oligos: null, error: `Row ${i + 1}: missing name.` }
    if (!seq)  return { oligos: null, error: `Row ${i + 1}: missing sequence.` }
    oligos.push({ name, sequence: seq })
  }
  return oligos.length ? { oligos, error: null } : { oligos: null, error: 'No data rows found.' }
}

function buildSurchargeMap(surcharges) {
  return Object.fromEntries(surcharges.map(s => [s.purification, parseFloat(s.surcharge) || 0]))
}

function linePrice(seqText, purification, surchargeMap) {
  const len = (seqText || '').replace(/[^A-Za-z]/g, '').length
  return len * PRICE_PER_NT + (surchargeMap[purification] ?? 0)
}

function calcSummary(lines, discountPct, discountAbs, surchargeMap) {
  const subtotal = lines
    .filter(l => l.included)
    .reduce((s, l) => s + linePrice(l.sequence_text, l.purification, surchargeMap), 0)
  const pct = parseFloat(discountPct) || 0
  const abs = parseFloat(discountAbs) || 0
  const discountTotal = subtotal * (pct / 100) + abs
  const net   = Math.max(0, subtotal - discountTotal)
  const vat   = net * VAT_RATE
  const total = net + vat
  return { subtotal, discountTotal, net, vat, total }
}

function fmt(n) {
  return '₪ ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function cleanBases(annotated, tokens) {
  if (tokens) {
    const t = typeof tokens === 'string' ? JSON.parse(tokens) : tokens
    if (t?.bases) return t.bases.toUpperCase()
  }
  return (annotated || '').replace(/\/[^/]+\//g, '').replace(/[^A-Za-z]/g, '').toUpperCase()
}

function extractPurif(notes) {
  if (!notes) return 'Standard Desalt'
  const m = notes.match(/Purification:\s*([^,]+)/i)
  return m ? m[1].trim() : 'Standard Desalt'
}

// ── SurchargeModal ────────────────────────────────────────────────────────────
function SurchargeModal({ surcharges, onSave, onClose }) {
  const [rows, setRows]   = useState(surcharges.map(s => ({ ...s })))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(rows)
    setSaving(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>Surcharge Settings</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
          Per-oligo surcharge (₪) added on top of {PRICE_PER_NT} ₪ × nt base price.
        </p>
        <table style={{ width: '100%', marginBottom: 20, fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Purification</th>
              <th style={{ textAlign: 'right', paddingBottom: 8, color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Surcharge (₪)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.purification}>
                <td style={{ padding: '6px 0', color: 'var(--text)' }}>{r.purification}</td>
                <td style={{ padding: '6px 0', textAlign: 'right' }}>
                  <input
                    type="number" min="0" step="0.50"
                    value={r.surcharge}
                    onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, surcharge: e.target.value } : x))}
                    style={{ width: 90, textAlign: 'right' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AddOligosPanel ────────────────────────────────────────────────────────────
function AddOligosPanel({ onAdd, onClose }) {
  const [tsv, setTsv]         = useState('')
  const [purif, setPurif]     = useState('Standard Desalt')
  const [scale, setScale]     = useState(50)
  const [preview, setPreview] = useState(null)
  const [err, setErr]         = useState('')

  function handlePreview() {
    setErr(''); setPreview(null)
    const { oligos, error } = parseTsv(tsv)
    if (error) { setErr(error); return }
    setPreview(oligos)
  }

  function handleAdd() {
    if (!preview) return
    onAdd(preview.map(o => ({
      _new: true,
      oligo_name:    o.name,
      sequence_text: o.sequence,
      purification:  purif,
      scale_nmol:    scale,
      included:      true,
    })))
    onClose()
  }

  return (
    <div className="qt-add-panel">
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        Paste rows from Excel (Name + Sequence). These will be added to the quote <strong>and</strong> saved to the order &amp; sequences database.
      </p>
      <textarea
        className="seq-textarea"
        style={{ fontFamily: 'var(--mono)', fontSize: 12, minHeight: 90, marginBottom: 8 }}
        placeholder={"Primer Name\tSequence\npRAS7.1_NheI_F\tTTGGCTCCGGTGCCC…"}
        value={tsv}
        onChange={e => { setTsv(e.target.value); setPreview(null); setErr('') }}
        spellCheck={false}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Default:</span>
        <select value={purif} onChange={e => setPurif(e.target.value)} style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>
          {PURIF_OPTIONS.map(p => <option key={p}>{p}</option>)}
        </select>
        <select value={scale} onChange={e => setScale(Number(e.target.value))} style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>
          {SCALE_OPTIONS.map(s => <option key={s} value={s}>{s} nmol</option>)}
        </select>
        <button className="btn-ghost" onClick={handlePreview} style={{ marginLeft: 'auto' }}>Preview</button>
        {preview && (
          <button className="btn-primary" onClick={handleAdd}>
            Add {preview.length} oligo{preview.length !== 1 ? 's' : ''}
          </button>
        )}
        <button className="btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>✕</button>
      </div>
      {err     && <div className="notice error"  style={{ marginTop: 8 }}>{err}</div>}
      {preview && <div className="notice" style={{ marginTop: 8, background: 'var(--surface2)', color: 'var(--text-muted)', fontSize: 12 }}>
        {preview.map(o => o.name).join(' · ')}
      </div>}
    </div>
  )
}

// ── QuoteEditor ───────────────────────────────────────────────────────────────
function QuoteEditor({ api, quoteId, orderId, orderRef, customerName, surcharges, onBack, onSurchargesChange, onSaved }) {
  const [lines, setLines]           = useState([])
  const [discountPct, setDiscountPct] = useState('')
  const [discountAbs, setDiscountAbs] = useState('')
  const [status, setStatus]         = useState('draft')
  const [notes, setNotes]           = useState('')
  const [loadingLines, setLoadingLines] = useState(true)
  const [saving, setSaving]         = useState(false)
  const [saveErr, setSaveErr]       = useState('')
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [showSurcharge, setShowSurcharge] = useState(false)
  const [currentId, setCurrentId]     = useState(quoteId)
  const [displayId, setDisplayId]     = useState(null)

  const surchargeMap = buildSurchargeMap(surcharges)

  // Load data on mount
  useEffect(() => {
    async function load() {
      setLoadingLines(true)
      try {
        if (quoteId) {
          // Editing existing quote
          const q = await api.get(`/quotes/${quoteId}`)
          setLines(q.lines || [])
          setDiscountPct(q.discount_pct > 0 ? String(q.discount_pct) : '')
          setDiscountAbs(q.discount_abs > 0 ? String(q.discount_abs) : '')
          setStatus(q.status || 'draft')
          setNotes(q.notes || '')
          setDisplayId(q.display_id || null)
        } else if (orderId) {
          // New quote from order — pre-populate lines
          const order = await api.get(`/orders/${orderId}`)
          setLines((order.lines || []).map((l, i) => ({
            id:            null,
            order_line_id: l.id,
            sequence_id:   l.sequence_id,
            oligo_name:    l.oligo_name || l.customer_label || '',
            sequence_text: cleanBases(l.annotated_sequence, l.tokens),
            purification:  extractPurif(l.notes),
            scale_nmol:    l.quantity_nmol,
            included:      true,
            sort_order:    i,
          })))
        }
      } catch (e) {
        setSaveErr('Failed to load data.')
      } finally {
        setLoadingLines(false)
      }
    }
    load()
  }, [quoteId, orderId])

  function toggleLine(idx) {
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, included: !l.included } : l))
  }

  function setPurif(idx, val) {
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, purification: val } : l))
  }

  function addLines(newLines) {
    setLines(ls => [...ls, ...newLines.map((l, j) => ({ ...l, sort_order: ls.length + j }))])
  }

  async function handleSave() {
    setSaving(true); setSaveErr('')
    try {
      const payload = {
        order_id:     orderId || null,
        discount_pct: parseFloat(discountPct) || 0,
        discount_abs: parseFloat(discountAbs) || 0,
        status,
        notes: notes || null,
        lines,
      }
      let savedId = quoteId
      if (quoteId) {
        await api.put(`/quotes/${quoteId}`, payload)
      } else {
        const r = await api.post('/quotes', payload)
        savedId = r.id
        setDisplayId(r.display_id || null)
      }
      setCurrentId(savedId)
      onSaved(savedId)
    } catch (err) {
      setSaveErr(err.response?.data?.error || 'Save failed.')
      setSaving(false)
    }
  }

  async function handleDownload() {
    try {
      const resp = await api.getRaw(`/quotes/${currentId}/docx`)
      if (!resp.ok) { setSaveErr('Download failed.'); return }
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `Quote-${displayId || currentId}${orderRef ? `-Order${orderRef}` : ''}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setSaveErr('Download failed.')
    }
  }

  const summary = calcSummary(lines, discountPct, discountAbs, surchargeMap)
  const includedCount = lines.filter(l => l.included).length

  const title = quoteId
    ? `Quote ${displayId || `#${quoteId}`}`
    : `New Quote${orderRef ? ` — Order #${orderRef}` : ''}`

  return (
    <div className="qt-editor">
      {/* Header */}
      <div className="qt-editor-head">
        <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onBack}>← Quotes</button>
        <span className="qt-editor-title">{title}</span>
        {customerName && <span className="qt-editor-meta">{customerName}</span>}
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
        >
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setShowSurcharge(true)}>
          ⚙ Surcharges
        </button>
      </div>

      {loadingLines ? (
        <div style={{ color: 'var(--text-muted)', padding: 20 }}>Loading…</div>
      ) : (
        <>
          {/* Lines table */}
          <div className="qt-lines-head">
            <span className="qt-lines-label">Oligos</span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {includedCount} of {lines.length} included
            </span>
            <button
              className="btn-ghost"
              style={{ fontSize: 12, padding: '2px 8px', marginLeft: 'auto' }}
              onClick={() => setLines(ls => ls.map(l => ({ ...l, included: true })))}
            >Select all</button>
            <button
              className="btn-ghost"
              style={{ fontSize: 12, padding: '2px 8px' }}
              onClick={() => setLines(ls => ls.map(l => ({ ...l, included: false })))}
            >Deselect all</button>
          </div>

          <table className="qt-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>#</th>
                <th>Name</th>
                <th>Sequence</th>
                <th style={{ textAlign: 'right' }}>Len</th>
                <th style={{ textAlign: 'right' }}>Scale</th>
                <th>Purification</th>
                <th style={{ textAlign: 'right' }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const price = linePrice(l.sequence_text, l.purification, surchargeMap)
                const len   = (l.sequence_text || '').replace(/[^A-Za-z]/g, '').length
                return (
                  <tr key={i} className={l.included ? '' : 'excluded'}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={!!l.included} onChange={() => toggleLine(i)} />
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{i + 1}</td>
                    <td style={{ fontWeight: 500, color: 'var(--text)' }}>{l.oligo_name || '—'}</td>
                    <td><span className="qt-seq">{l.sequence_text}</span></td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>{len}</td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                      {l.scale_nmol ? `${l.scale_nmol}` : '—'}
                    </td>
                    <td>
                      <select
                        className="qt-purif-select"
                        value={l.purification}
                        onChange={e => setPurif(i, e.target.value)}
                      >
                        {PURIF_OPTIONS.map(p => <option key={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="qt-price-cell">
                      {l.included ? fmt(price) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Add oligos toggle */}
          {!showAddPanel ? (
            <button className="qt-add-toggle" onClick={() => setShowAddPanel(true)}>
              + Add oligos from spreadsheet
            </button>
          ) : (
            <AddOligosPanel onAdd={addLines} onClose={() => setShowAddPanel(false)} />
          )}

          {/* Discount */}
          <div className="qt-discount-row">
            <span className="qt-discount-label">Discount</span>
            <div className="qt-discount-field">
              <input
                type="number" min="0" max="100" step="1" placeholder="0"
                value={discountPct}
                onChange={e => setDiscountPct(e.target.value)}
                style={{ width: 80 }}
              />
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>%</span>
            </div>
            <span className="qt-discount-sep">+</span>
            <div className="qt-discount-field">
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>₪</span>
              <input
                type="number" min="0" step="1" placeholder="0"
                value={discountAbs}
                onChange={e => setDiscountAbs(e.target.value)}
                style={{ width: 90 }}
              />
            </div>
          </div>

          {/* Price summary */}
          <div className="qt-summary">
            <div className="qt-summary-row">
              <span>Subtotal ({includedCount} oligos)</span>
              <span className="qt-summary-amount">{fmt(summary.subtotal)}</span>
            </div>
            {summary.discountTotal > 0 && (
              <div className="qt-summary-row discount">
                <span>Discount</span>
                <span className="qt-summary-amount">− {fmt(summary.discountTotal)}</span>
              </div>
            )}
            <div className="qt-summary-row">
              <span>Net</span>
              <span className="qt-summary-amount">{fmt(summary.net)}</span>
            </div>
            <div className="qt-summary-row">
              <span>VAT ({(VAT_RATE * 100).toFixed(0)}%)</span>
              <span className="qt-summary-amount">{fmt(summary.vat)}</span>
            </div>
            <div className="qt-summary-row total">
              <span>Total</span>
              <span className="qt-summary-amount">{fmt(summary.total)}</span>
            </div>
          </div>

          {/* Notes */}
          <div className="field" style={{ marginTop: 16 }}>
            <label>Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Internal notes for this quote…"
              style={{ minHeight: 56 }}
            />
          </div>

          {saveErr && <div className="notice error" style={{ marginTop: 8 }}>{saveErr}</div>}

          <div className="qt-actions">
            <button className="btn-ghost" onClick={onBack}>← Back</button>
            {currentId && (
              <button className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={handleDownload}>
                ⬇ Download .docx
              </button>
            )}
            <button className="btn-primary" disabled={saving || lines.length === 0} onClick={handleSave}>
              {saving ? 'Saving…' : currentId ? 'Save changes' : 'Create quote'}
            </button>
          </div>
        </>
      )}

      {showSurcharge && (
        <SurchargeModal
          surcharges={surcharges}
          onSave={async rows => {
            const updated = await api.put('/surcharges', { surcharges: rows })
            onSurchargesChange(updated)
            setShowSurcharge(false)
          }}
          onClose={() => setShowSurcharge(false)}
        />
      )}
    </div>
  )
}

// ── Quotes (main list) ────────────────────────────────────────────────────────
export default function Quotes({ api, initialOrderId, initialOrderRef, initialMode }) {
  const [view, setView]           = useState(initialMode === 'create' ? 'editor' : 'list')
  const [quotes, setQuotes]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [surcharges, setSurcharges] = useState([])
  const [editQuoteId, setEditQuoteId] = useState(null)
  const [editOrderId, setEditOrderId] = useState(initialMode === 'create' ? initialOrderId : null)
  const [editOrderRef, setEditOrderRef] = useState(initialMode === 'create' ? initialOrderRef : null)
  const [editCustomerName, setEditCustomerName] = useState(null)
  const [deleteQuote, setDeleteQuote] = useState(null)
  const [deleting, setDeleting]   = useState(false)
  const [search, setSearch]       = useState('')
  const [filterOrderId, setFilterOrderId] = useState(
    initialMode === 'view' ? initialOrderId : null
  )

  useEffect(() => {
    Promise.all([
      api.get('/quotes'),
      api.get('/surcharges'),
    ]).then(([qs, scs]) => {
      setQuotes(qs)
      setSurcharges(scs)
    }).finally(() => setLoading(false))
  }, [])

  function openCreate(orderId = null, orderRef = null, customerName = null) {
    setEditQuoteId(null)
    setEditOrderId(orderId)
    setEditOrderRef(orderRef)
    setEditCustomerName(customerName)
    setView('editor')
  }

  function openEdit(q) {
    setEditQuoteId(q.id)
    setEditOrderId(q.order_id)
    setEditOrderRef(q.customer_ref)
    setEditCustomerName(q.customer_name)
    setView('editor')
  }

  async function handleSaved(savedId) {
    // Refresh list in background; stay in editor so download button is accessible
    api.get('/quotes').then(qs => setQuotes(qs))
    // Update editQuoteId so re-opening from list works correctly
    setEditQuoteId(savedId)
  }

  async function confirmDelete() {
    setDeleting(true)
    try {
      await api.del(`/quotes/${deleteQuote.id}`)
      setQuotes(qs => qs.filter(q => q.id !== deleteQuote.id))
      setDeleteQuote(null)
    } finally {
      setDeleting(false)
    }
  }

  const surchargeMap = buildSurchargeMap(surcharges)

  const q_term = search.trim().toLowerCase()
  const displayed = quotes.filter(q => {
    if (filterOrderId && q.order_id !== filterOrderId) return false
    if (!q_term) return true
    return (
      (q.display_id      || '').toLowerCase().includes(q_term) ||
      (q.customer_name   || '').toLowerCase().includes(q_term) ||
      (q.customer_ref    || '').toLowerCase().includes(q_term) ||
      (q.customer_email  || '').toLowerCase().includes(q_term)
    )
  })

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading…</div>

  // ── Editor view ──
  if (view === 'editor') {
    return (
      <QuoteEditor
        api={api}
        quoteId={editQuoteId}
        orderId={editOrderId}
        orderRef={editOrderRef}
        customerName={editCustomerName}
        surcharges={surcharges}
        onBack={() => setView('list')}
        onSurchargesChange={setSurcharges}
        onSaved={handleSaved}
      />
    )
  }

  // ── List view ──
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Quotes</h2>
          <p>
            {displayed.length}{displayed.length !== quotes.length ? ` of ${quotes.length}` : ''} quote{quotes.length !== 1 ? 's' : ''}
            {filterOrderId && (
              <button className="btn-ghost" style={{ fontSize: 11, padding: '1px 8px', marginLeft: 10 }}
                      onClick={() => setFilterOrderId(null)}>Order filter ✕</button>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="search"
            placeholder="Search quote ID, customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 220 }}
          />
          <button className="btn-primary" onClick={() => openCreate()}>+ New quote</button>
        </div>
      </div>

      {displayed.length === 0 ? (
        <div className="notice warn">No quotes yet.{filterOrderId ? ' None for this order.' : ''}</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Quote No</th>
              <th>Order #</th>
              <th>Customer</th>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>Oligos</th>
              <th style={{ textAlign: 'right' }}>Net</th>
              <th style={{ textAlign: 'right' }}>Total incl. VAT</th>
              <th>Status</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {displayed.map(q => {
              const subtotal = parseFloat(q.subtotal) || 0
              const pct = parseFloat(q.discount_pct) || 0
              const abs = parseFloat(q.discount_abs) || 0
              const net = Math.max(0, subtotal - subtotal * (pct / 100) - abs)
              const total = net * (1 + VAT_RATE)
              return (
                <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => openEdit(q)}>
                  <td className="mono primary">{q.display_id || '—'}</td>
                  <td className="mono">{q.customer_ref ?? '—'}</td>
                  <td>{q.customer_name ?? '—'}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{q.created_date}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{q.line_count}</td>
                  <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>{fmt(net)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{fmt(total)}</td>
                  <td><span className={`qt-status ${q.status}`}>{q.status}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    <button
                      className="btn-ghost"
                      style={{ fontSize: 12, padding: '3px 8px', color: 'var(--danger)' }}
                      onClick={() => setDeleteQuote(q)}
                    >Delete</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* Delete confirmation */}
      {deleteQuote && (
        <div className="modal-backdrop" onClick={() => setDeleteQuote(null)}>
          <div className="modal-box" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 10 }}>Delete Quote {deleteQuote.display_id || `#${deleteQuote.id}`}?</h3>
            <p style={{ color: 'var(--text-dim)', marginBottom: 18, fontSize: 13 }}>
              This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setDeleteQuote(null)}>Cancel</button>
              <button className="btn-danger" disabled={deleting} onClick={confirmDelete}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
