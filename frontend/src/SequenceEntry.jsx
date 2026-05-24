import { useState } from 'react'
import './SequenceEntry.css'

export default function SequenceEntry({ api }) {
  const [input, setInput]       = useState('')
  const [preview, setPreview]   = useState(null)
  const [previewErr, setPreviewErr] = useState('')
  const [loading, setLoading]   = useState(false)
  const [inserted, setInserted] = useState(null)
  const [insertErr, setInsertErr] = useState('')

  async function handlePreview() {
    if (!input.trim()) return
    setLoading(true)
    setPreview(null)
    setPreviewErr('')
    setInserted(null)
    setInsertErr('')
    try {
      const data = await api.post('/parse', { sequence: input.trim() })
      setPreview(data)
    } catch (err) {
      setPreviewErr(err.response?.data?.error || 'Parse failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleInsert() {
    setLoading(true)
    setInsertErr('')
    setInserted(null)
    try {
      const data = await api.post('/sequences', { sequence: input.trim() })
      setInserted(data.id)
      setPreview(null)
      setInput('')
    } catch (err) {
      setInsertErr(err.response?.data?.error || 'Insert failed')
    } finally {
      setLoading(false)
    }
  }

  const oligoTypeTag = preview
    ? preview.oligo_type === 'DNA' ? 'dna'
    : preview.oligo_type === 'RNA' ? 'rna' : 'mixed'
    : ''

  return (
    <div className="seq-entry">
      <div className="section-head">
        <h2>Enter Sequence</h2>
        <p>Paste an IDT-formatted sequence. Mods use /5Name/, /iName/, /3Name/ notation.</p>
      </div>

      <div className="field">
        <label>Sequence Input</label>
        <textarea
          className="seq-textarea"
          value={input}
          onChange={e => { setInput(e.target.value); setPreview(null); setInserted(null) }}
          placeholder="/5Cy5/ACGTrArCrGrU/iSp3/TTACG/3Biotin/"
          rows={3}
        />
      </div>

      <div className="entry-actions">
        <button className="btn-ghost" onClick={handlePreview} disabled={loading || !input.trim()}>
          {loading ? 'Parsing…' : 'Preview'}
        </button>
        {preview && !preview.has_errors && (
          <button className="btn-primary" onClick={handleInsert} disabled={loading}>
            Save to Database
          </button>
        )}
      </div>

      {previewErr && <div className="notice error">{previewErr}</div>}
      {insertErr  && <div className="notice error">{insertErr}</div>}
      {inserted   && <div className="notice success">Saved — ID: <span className="mono">{inserted}</span></div>}

      {preview && (
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-label">Parse Preview</span>
            <span className={`tag ${oligoTypeTag}`}>{preview.oligo_type}</span>
            {preview.has_errors && <span className="tag error">Error</span>}
          </div>

          <div className="preview-seq">
            <span className="seq-label">Clean Bases</span>
            <span className="seq-bases">{preview.clean_bases}</span>
            <span className="seq-len">{preview.clean_bases?.length} nt</span>
          </div>

          {preview.has_errors && (
            <div className="notice error" style={{marginTop: 12}}>{preview.error_detail}</div>
          )}

          {preview.modifications?.length > 0 && (
            <div className="mod-list">
              <div className="mod-list-head">Modifications</div>
              <table>
                <thead>
                  <tr>
                    <th>Canonical Name</th>
                    <th>Position Type</th>
                    <th>After nt index</th>
                    <th>Display order</th>
                    <th>In Catalog</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.modifications.map((m, i) => (
                    <tr key={i}>
                      <td className="primary">{m.canonical_name || m.raw_token}</td>
                      <td><span className="tag">{m.position_type}</span></td>
                      <td className="mono">{m.after_nt_index ?? '—'}</td>
                      <td className="mono">{m.display_order ?? '—'}</td>
                      <td>{m.resolved ? '✓' : <span className="tag error">Unknown</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
