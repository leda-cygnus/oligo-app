import { useState, useRef } from 'react'
import './OrderImport.css'

const EMPTY_STATE = { parsed: null, error: '', loading: false, success: null }

export default function OrderImport({ api }) {
  const [mode, setMode]       = useState('text')
  const [text, setText]       = useState('')
  const [file, setFile]       = useState(null)
  const [state, setState]     = useState(EMPTY_STATE)
  const [source, setSource]   = useState('website')
  const fileRef               = useRef()

  function reset() {
    setState(EMPTY_STATE)
  }

  function switchMode(m) {
    setMode(m)
    setState(EMPTY_STATE)
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleParse() {
    setState({ ...EMPTY_STATE, loading: true })
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
        <p>Paste email text or upload a .docx order file to preview and import into the database.</p>
      </div>

      <div className="oi-mode-bar">
        <button className={`oi-mode-btn ${mode === 'text' ? 'active' : ''}`} onClick={() => switchMode('text')}>
          Paste Text
        </button>
        <button className={`oi-mode-btn ${mode === 'file' ? 'active' : ''}`} onClick={() => switchMode('file')}>
          Upload .docx
        </button>
      </div>

      {mode === 'text' ? (
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
      ) : (
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
          </div>

          <div className="oi-meta-grid">
            {parsed.customer_name  && <><span className="oi-meta-key">Customer</span><span>{parsed.customer_name}</span></>}
            {parsed.customer_email && <><span className="oi-meta-key">Email</span><span className="mono">{parsed.customer_email}</span></>}
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
    </div>
  )
}
