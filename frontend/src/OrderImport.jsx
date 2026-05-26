import { useState, useRef, useEffect } from 'react'
import './OrderImport.css'

const EMPTY_STATE = { parsed: null, error: '', loading: false, success: null }

const SCALE_OPTIONS    = [25, 50, 100, 200, 1000]
const PURIF_OPTIONS    = ['Standard Desalt', 'HPLC', 'PAGE', 'RNase-free HPLC']
const FORMUL_OPTIONS   = ['Dry', 'TE Buffer', 'Water']

// ── TSV helpers ───────────────────────────────────────────────────────────────

function mapOligoType(raw) {
  if (!raw) return 'DNA'
  const r = raw.toLowerCase()
  if (r.includes('rna')) return 'RNA'
  return 'DNA'
}

function mapDelivery(raw) {
  if (!raw) return null
  const r = raw.toLowerCase()
  if (r.includes('lyophil') || r.includes('dry') || r.includes('freeze')) return 'Dry'
  if (r.includes('te')) return 'TE Buffer'
  if (r.includes('water') || r.includes('h2o')) return 'Water'
  return null
}

// Extract the modification name from a string that may have a position prefix
// like "5' Mod: Cy5" → "Cy5", or return the string as-is if no colon present.
function stripModPrefix(s) {
  const c = s.lastIndexOf(':')
  return c >= 0 ? s.slice(c + 1).trim() : s.trim()
}

// Build modification_notes from dedicated position columns and/or a legacy
// combined "Modification" column.  Dedicated columns take priority; the legacy
// column is parsed as a fallback, stripping any "5' Mod: " prefix.
function buildModNotes(rawMod, rawMod5, rawMod3, rawModInt1, rawModInt2, rawModInt3) {
  let five  = rawMod5?.trim()    || ''
  let three = rawMod3?.trim()    || ''
  let int1  = rawModInt1?.trim() || ''
  let int2  = rawModInt2?.trim() || ''
  let int3  = rawModInt3?.trim() || ''

  if (rawMod?.trim()) {
    let intN = 0
    for (const part of rawMod.split(',')) {
      const s    = part.trim()
      if (!s) continue
      const name = stripModPrefix(s)
      if      (/^5/i.test(s))       { if (!five)  five  = name }
      else if (/^3/i.test(s))       { if (!three) three = name }
      else if (/internal/i.test(s)) {
        intN++
        if      (intN === 1 && !int1) int1 = name
        else if (intN === 2 && !int2) int2 = name
        else if (intN === 3 && !int3) int3 = name
      } else                        { if (!five)  five  = name }
    }
  }

  const parts = []
  if (five)  parts.push(`5' Mod: ${five}`)
  if (three) parts.push(`3' Mod: ${three}`)
  if (int1)  parts.push(`Internal Mod 1: ${int1}`)
  if (int2)  parts.push(`Internal Mod 2: ${int2}`)
  if (int3)  parts.push(`Internal Mod 3: ${int3}`)
  return parts.length ? parts.join(', ') : null
}

// ── TSV fuzzy parser ──────────────────────────────────────────────────────────
function parseTsv(raw) {
  const lines = raw.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { oligos: null, cols: {}, error: 'Need at least a header row and one data row.' }

  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase())

  // Required
  const nameIdx  = headers.findIndex(h =>
    h.includes('name') || h.includes('primer') || h.includes('oligo') || h.includes('id')
  )
  const seqIdx   = headers.findIndex(h => h.includes('seq'))

  if (nameIdx === -1) return { oligos: null, cols: {}, error: 'Could not find a Name column (expected header containing "name", "primer", or "oligo").' }
  if (seqIdx  === -1) return { oligos: null, cols: {}, error: 'Could not find a Sequence column (expected header containing "seq").' }

  // Optional — detected but not required
  const modIdx   = headers.findIndex(h => h.includes('modif'))
  const mod5Idx  = headers.findIndex(h => h.startsWith('5') && h.includes('mod'))
  const mod3Idx  = headers.findIndex(h => h.startsWith('3') && h.includes('mod'))
  const int1Idx  = headers.findIndex(h => h.startsWith('int') && h.includes('1'))
  const int2Idx  = headers.findIndex(h => h.startsWith('int') && h.includes('2'))
  const int3Idx  = headers.findIndex(h => h.startsWith('int') && h.includes('3'))
  const purifIdx = headers.findIndex(h => h.includes('purif'))
  const typeIdx  = headers.findIndex(h => h.includes('type') && !h.includes('oligo') && !h.includes('name'))
  // "Oligo Type" header → fall back to any header containing "type"
  const typeIdx2 = typeIdx === -1 ? headers.findIndex(h => h.includes('type')) : typeIdx
  const delivIdx = headers.findIndex(h =>
    h.includes('deliv') || h.includes('state') || h.includes('formul')
  )

  const cols = {
    mod:     modIdx  >= 0,
    mod5:    mod5Idx >= 0,
    mod3:    mod3Idx >= 0,
    modInt1: int1Idx >= 0,
    modInt2: int2Idx >= 0,
    modInt3: int3Idx >= 0,
    purif:    purifIdx >= 0,
    type:     typeIdx2 >= 0,
    delivery: delivIdx >= 0,
  }

  const oligos = []
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t').map(s => s.trim())
    const name     = c[nameIdx]  || ''
    const sequence = (c[seqIdx]  || '').replace(/\s/g, '').toUpperCase()
    // Skip sub-header rows or empty rows
    if (!name && !sequence) continue
    if (!name)     return { oligos: null, cols, error: `Row ${i + 1}: missing name.` }
    if (!sequence) return { oligos: null, cols, error: `Row ${i + 1}: missing sequence.` }
    // Skip rows where sequence column is clearly a sub-header (contains no ACGTU letters)
    if (!sequence.replace(/[^ACGTURYWSKMBDHVN]/gi, '').length) continue

    oligos.push({
      name,
      sequence,
      rawMod:      modIdx  >= 0 ? (c[modIdx]  || '') : '',
      rawMod5:     mod5Idx >= 0 ? (c[mod5Idx] || '') : '',
      rawMod3:     mod3Idx >= 0 ? (c[mod3Idx] || '') : '',
      rawModInt1:  int1Idx >= 0 ? (c[int1Idx] || '') : '',
      rawModInt2:  int2Idx >= 0 ? (c[int2Idx] || '') : '',
      rawModInt3:  int3Idx >= 0 ? (c[int3Idx] || '') : '',
      rawPurif:    purifIdx >= 0 ? (c[purifIdx]  || '') : '',
      rawType:     typeIdx2 >= 0 ? (c[typeIdx2]  || '') : '',
      rawDelivery: delivIdx >= 0 ? (c[delivIdx]  || '') : '',
    })
  }

  if (!oligos.length) return { oligos: null, cols, error: 'No data rows found.' }
  return { oligos, cols, error: null }
}

// ── CustomerModal ─────────────────────────────────────────────────────────────
function CustomerModal({ api, oligoCount, detectedCols, onConfirm, onCancel }) {
  const [customers, setCustomers]     = useState([])
  const [loadingCust, setLoadingCust] = useState(true)
  const [mode, setMode]               = useState('existing')
  const [search, setSearch]           = useState('')
  const [selectedId, setSelectedId]   = useState(null)

  const [newForm, setNewForm] = useState({
    contact_name: '', company_name: '', email: '',
  })

  const [scale, setScale]   = useState(50)
  const [purif, setPurif]   = useState('Standard Desalt')
  const [formul, setFormul] = useState('Dry')
  const [err, setErr]       = useState('')

  useEffect(() => {
    api.get('/customers')
      .then(data => { setCustomers(data); setLoadingCust(false) })
      .catch(() => { setLoadingCust(false) })
  }, [])

  const filtered = customers.filter(c => {
    const q = search.toLowerCase()
    return (
      (c.contact_name  || '').toLowerCase().includes(q) ||
      (c.company_name  || '').toLowerCase().includes(q) ||
      (c.email         || '').toLowerCase().includes(q)
    )
  })

  function handleConfirm() {
    setErr('')
    let customer_name = null, customer_email = null, institute = null

    if (mode === 'existing') {
      if (!selectedId) { setErr('Select a customer or switch to New.'); return }
      const c = customers.find(x => x.id === selectedId)
      customer_name  = c.contact_name  || null
      customer_email = c.email         || null
      institute      = c.company_name  || null
    } else {
      if (!newForm.contact_name.trim()) { setErr('Contact name is required.'); return }
      customer_name  = newForm.contact_name.trim()
      customer_email = newForm.email.trim()       || null
      institute      = newForm.company_name.trim()|| null
    }

    onConfirm({ customer_name, customer_email, institute, scale, purif, formul })
  }

  const anyPerRow = detectedCols.mod || detectedCols.mod5 || detectedCols.mod3 ||
    detectedCols.modInt1 || detectedCols.modInt2 || detectedCols.modInt3 ||
    detectedCols.purif || detectedCols.type || detectedCols.delivery
  const perRowLabels = [
    detectedCols.mod5     && "5' Mod",
    detectedCols.mod3     && "3' Mod",
    detectedCols.modInt1  && 'Int1 Mod',
    detectedCols.modInt2  && 'Int2 Mod',
    detectedCols.modInt3  && 'Int3 Mod',
    detectedCols.mod      && 'Modification',
    detectedCols.purif    && 'Purification',
    detectedCols.type     && 'Oligo type',
    detectedCols.delivery && 'Formulation',
  ].filter(Boolean)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box oi-cust-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>Customer &amp; order details</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: anyPerRow ? 8 : 20 }}>
          {oligoCount} oligo{oligoCount !== 1 ? 's' : ''} parsed — fill in the missing details to complete the import.
        </p>

        {/* ── Per-row columns detected ── */}
        {anyPerRow && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            marginBottom: 16, padding: '8px 10px',
            background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.2)',
            borderRadius: 'var(--radius)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-dim)' }}>Detected per-row:</span>
            {perRowLabels.map(l => (
              <span key={l} style={{
                padding: '2px 8px', borderRadius: 99,
                background: 'rgba(99,179,237,0.15)', color: 'var(--accent)',
                fontWeight: 500,
              }}>{l}</span>
            ))}
            <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>
              — defaults below are used only where not specified in the spreadsheet
            </span>
          </div>
        )}

        {/* ── Order defaults ── */}
        <div className="oi-cust-section-label">
          Order defaults{anyPerRow ? ' (fallback)' : ''}
        </div>
        <div className="oi-cust-defaults">
          <div className="field">
            <label>Scale (nmol)</label>
            <select value={scale} onChange={e => setScale(Number(e.target.value))}>
              {SCALE_OPTIONS.map(s => <option key={s} value={s}>{s} nmol</option>)}
            </select>
          </div>
          <div className="field">
            <label>Purification{detectedCols.purif ? ' ↙ per-row' : ''}</label>
            <select value={purif} onChange={e => setPurif(e.target.value)}
                    style={detectedCols.purif ? { opacity: 0.55 } : {}}>
              {PURIF_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Formulation{detectedCols.delivery ? ' ↙ per-row' : ''}</label>
            <select value={formul} onChange={e => setFormul(e.target.value)}
                    style={detectedCols.delivery ? { opacity: 0.55 } : {}}>
              {FORMUL_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        {/* ── Customer ── */}
        <div className="oi-cust-section-label" style={{ marginTop: 20 }}>Customer</div>
        <div className="oi-cust-tabs">
          <button
            className={`oi-mode-btn ${mode === 'existing' ? 'active' : ''}`}
            onClick={() => setMode('existing')}
          >Select existing</button>
          <button
            className={`oi-mode-btn ${mode === 'new' ? 'active' : ''}`}
            onClick={() => setMode('new')}
          >New customer</button>
        </div>

        {mode === 'existing' ? (
          <>
            <input
              className="oi-cust-search"
              placeholder="Search by name, company or email…"
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedId(null) }}
            />
            {loadingCust
              ? <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Loading customers…</div>
              : filtered.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>No customers found.</div>
                : (
                  <div className="oi-cust-list">
                    {filtered.map(c => (
                      <div
                        key={c.id}
                        className={`oi-cust-row ${selectedId === c.id ? 'selected' : ''}`}
                        onClick={() => setSelectedId(c.id)}
                      >
                        <span className="oi-cust-name">{c.contact_name || <em style={{ color: 'var(--text-dim)' }}>No name</em>}</span>
                        <span className="oi-cust-company">{c.company_name || ''}</span>
                        <span className="oi-cust-email mono">{c.email || ''}</span>
                      </div>
                    ))}
                  </div>
                )
            }
          </>
        ) : (
          <div className="oi-cust-new-form">
            {[
              { key: 'contact_name', label: 'Contact name *' },
              { key: 'company_name', label: 'Company / Institute' },
              { key: 'email',        label: 'Email' },
            ].map(({ key, label }) => (
              <div key={key} className="field" style={{ marginBottom: 10 }}>
                <label>{label}</label>
                <input
                  value={newForm[key]}
                  onChange={e => setNewForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleConfirm}>Continue →</button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OrderImport({ api }) {
  const [mode, setMode]     = useState('text')
  const [text, setText]     = useState('')
  const [tsv, setTsv]       = useState('')
  const [file, setFile]     = useState(null)
  const [state, setState]   = useState(EMPTY_STATE)
  const [source, setSource] = useState('website')
  const [showCustModal, setShowCustModal] = useState(false)
  const [tsvOligos, setTsvOligos]         = useState(null)
  const [tsvCols, setTsvCols]             = useState({})
  const fileRef = useRef()

  function reset() { setState(EMPTY_STATE) }

  function switchMode(m) {
    setMode(m)
    setState(EMPTY_STATE)
    setFile(null)
    setShowCustModal(false)
    setTsvOligos(null)
    setTsvCols({})
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Parse ──
  async function handleParse() {
    setState({ ...EMPTY_STATE, loading: true })

    if (mode === 'excel') {
      if (!tsv.trim()) return setState({ ...EMPTY_STATE, error: 'Paste spreadsheet data first.' })
      const { oligos, cols, error } = parseTsv(tsv)
      if (error) return setState({ ...EMPTY_STATE, error })
      setTsvOligos(oligos)
      setTsvCols(cols)
      setState({ ...EMPTY_STATE })
      setShowCustModal(true)
      return
    }

    try {
      let parsed
      if (mode === 'text') {
        if (!text.trim()) return setState({ ...EMPTY_STATE, error: 'Paste order text first' })
        parsed = await api.post('/orders/parse-text', { text: text.trim() })
      } else {
        if (!file) return setState({ ...EMPTY_STATE, error: 'Select a .docx file first' })
        parsed = await api.upload('/orders/parse-docx', file)
      }
      if (!parsed.oligos?.length) {
        setState({ ...EMPTY_STATE, error: 'No oligos found — check the format' })
      } else {
        setState({ ...EMPTY_STATE, parsed })
      }
    } catch (err) {
      setState({ ...EMPTY_STATE, error: err.response?.data?.error || 'Parse failed' })
    }
  }

  // ── Customer modal confirmed ──
  function handleCustomerConfirm({ customer_name, customer_email, institute, scale, purif, formul }) {
    setShowCustModal(false)
    const parsed = {
      order_ref:      null,
      customer_name,
      customer_email,
      institute,
      address:        null,
      order_date:     null,
      raw_text:       '',
      oligos: tsvOligos.map((o, i) => {
        // Per-row values override the modal defaults where found
        const rowPurif  = o.rawPurif    || purif
        const rowFormul = (o.rawDelivery && mapDelivery(o.rawDelivery)) || formul
        const rowType   = mapOligoType(o.rawType)
        const rowMod    = buildModNotes(o.rawMod, o.rawMod5, o.rawMod3, o.rawModInt1, o.rawModInt2, o.rawModInt3)

        return {
          name:               o.name,
          oligo_type:         rowType,
          sequence:           o.sequence,
          scale_nmol:         scale,
          purification:       rowPurif,
          formulation:        rowFormul,
          modification_notes: rowMod,
          researcher:         null,
          line_number:        i + 1,
        }
      }),
    }
    setState({ ...EMPTY_STATE, parsed })
  }

  // ── Import ──
  async function handleImport() {
    setState(s => ({ ...s, loading: true, success: null, error: '' }))
    try {
      const result = await api.post('/orders', { parsed: state.parsed, source })
      setState(s => ({ ...s, loading: false, success: result }))
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err.response?.data?.error || 'Import failed' }))
    }
  }

  const { parsed, error, loading, success } = state

  return (
    <div className="order-import">
      <div className="section-head">
        <h2>Import Order</h2>
        <p>Paste email text, upload a .docx file, or paste rows copied from Excel.</p>
      </div>

      <div className="oi-mode-bar">
        <button className={`oi-mode-btn ${mode === 'text'  ? 'active' : ''}`} onClick={() => switchMode('text')}>
          Paste Text
        </button>
        <button className={`oi-mode-btn ${mode === 'file'  ? 'active' : ''}`} onClick={() => switchMode('file')}>
          Upload .docx
        </button>
        <button className={`oi-mode-btn ${mode === 'excel' ? 'active' : ''}`} onClick={() => switchMode('excel')}>
          Excel / TSV
        </button>
      </div>

      {mode === 'text' && (
        <div className="field">
          <label>Order Email Text</label>
          <textarea
            className="seq-textarea oi-textarea"
            value={text}
            onChange={e => { setText(e.target.value); reset() }}
            placeholder="Paste the full order email text here…"
            rows={6}
          />
        </div>
      )}

      {mode === 'file' && (
        <div className="field">
          <label>Order File (.docx)</label>
          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            className="oi-file-input"
            onChange={e => { setFile(e.target.files[0] || null); setState(EMPTY_STATE) }}
          />
        </div>
      )}

      {mode === 'excel' && (
        <div className="field">
          <label>Paste from Excel</label>
          <textarea
            className="seq-textarea oi-textarea oi-tsv-area"
            value={tsv}
            onChange={e => { setTsv(e.target.value); reset() }}
            placeholder={"Paste rows copied from Excel. Expected columns (fuzzy match):\nName\tSequence\t[5' Mod]\t[3' Mod]\t[Int1 Mod]\t[Int2 Mod]\t[Int3 Mod]\t[Purification]\t[Oligo Type]\t[Delivery]\n\nColumn order and extra columns don't matter. Optional columns are used per-row when present."}
            rows={8}
            spellCheck={false}
          />
          <div className="oi-tsv-hint">
            Must include <span className="mono">Name</span> and <span className="mono">Sequence</span> columns.
            Also auto-detected when present:{' '}
            <span className="mono">5' Mod</span>, <span className="mono">3' Mod</span>,{' '}
            <span className="mono">Int1–3 Mod</span>, <span className="mono">Modification</span>,{' '}
            <span className="mono">Purification</span>, <span className="mono">Oligo Type</span>,{' '}
            <span className="mono">Delivery</span>.
          </div>
        </div>
      )}

      <div className="entry-actions">
        <button className="btn-ghost" onClick={handleParse} disabled={loading}>
          {loading && !parsed ? 'Parsing…' : 'Preview'}
        </button>
        {parsed && !success && (
          <>
            <label className="oi-source-label">Source</label>
            <select className="oi-source-select" value={source} onChange={e => setSource(e.target.value)}>
              <option value="website">Website</option>
              <option value="email">Email</option>
              <option value="internal">Internal</option>
            </select>
            <button className="btn-primary" onClick={handleImport} disabled={loading}>
              {loading ? 'Importing…' : 'Import Order'}
            </button>
          </>
        )}
      </div>

      {error   && <div className="notice error">{error}</div>}
      {success && (
        <div className="notice success">
          Order imported — ID: <span className="mono">{success.order_id}</span>
          {' '}({success.line_count} oligo{success.line_count !== 1 ? 's' : ''})
        </div>
      )}

      {parsed && !success && (
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-label">Order Preview</span>
            {parsed.order_ref && <span className="tag">#{parsed.order_ref}</span>}
            {mode === 'excel' && <span className="tag" style={{ background: 'rgba(160,120,255,0.12)', color: '#a078ff', borderColor: 'rgba(160,120,255,0.2)' }}>Excel import</span>}
          </div>

          <div className="oi-meta-grid">
            {parsed.customer_name  && <><span className="oi-meta-key">Customer</span><span>{parsed.customer_name}</span></>}
            {parsed.customer_email && <><span className="oi-meta-key">Email</span><span className="mono">{parsed.customer_email}</span></>}
            {parsed.institute      && <><span className="oi-meta-key">Institute</span><span>{parsed.institute}</span></>}
            {parsed.order_date     && <><span className="oi-meta-key">Date</span><span>{parsed.order_date}</span></>}
            <span className="oi-meta-key">Oligos</span><span>{parsed.oligos.length}</span>
          </div>

          <div className="mod-list-head" style={{ marginTop: 20 }}>Oligos</div>
          <table className="oi-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Type</th>
                <th>Sequence</th>
                <th>Scale</th>
                <th>Purification</th>
                <th>Modification</th>
                <th>Formulation</th>
              </tr>
            </thead>
            <tbody>
              {parsed.oligos.map((o, i) => (
                <tr key={i}>
                  <td className="mono">{i + 1}</td>
                  <td className="primary">{o.name}</td>
                  <td><span className={`tag ${o.oligo_type === 'DNA' ? 'dna' : 'rna'}`}>{o.oligo_type}</span></td>
                  <td className="mono oi-seq">{o.sequence}</td>
                  <td className="mono">{o.scale_nmol} nmol</td>
                  <td>{o.purification}</td>
                  <td>{o.modification_notes || '—'}</td>
                  <td>{o.formulation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCustModal && (
        <CustomerModal
          api={api}
          oligoCount={tsvOligos?.length ?? 0}
          detectedCols={tsvCols}
          onConfirm={handleCustomerConfirm}
          onCancel={() => { setShowCustModal(false); setState(EMPTY_STATE) }}
        />
      )}
    </div>
  )
}
