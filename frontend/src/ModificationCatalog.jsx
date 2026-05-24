import { useState, useEffect } from 'react'

const EMPTY = {
  canonical_name: '', aliases: '', chemistry_class: 'standard',
  end_5prime_ok: true, end_3prime_ok: true, internal_ok: true,
  machine_position_required: true, description: ''
}

export default function ModificationCatalog({ api }) {
  const [mods, setMods]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [form, setForm]       = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saveErr, setSaveErr] = useState('')

  function load() {
    setLoading(true)
    api.get('/modifications')
      .then(setMods)
      .catch(() => setError('Failed to load catalog'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function handleSave() {
    setSaving(true)
    setSaveErr('')
    try {
      const payload = {
        ...form,
        aliases: form.aliases.split(',').map(a => a.trim()).filter(Boolean)
      }
      await api.post('/modifications', payload)
      setForm(null)
      load()
    } catch (err) {
      setSaveErr(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  if (loading) return <div style={{color:'var(--text-muted)'}}>Loading…</div>
  if (error)   return <div className="notice error">{error}</div>

  return (
    <div>
      <div className="section-head" style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between'}}>
        <div>
          <h2>Modification Catalog</h2>
          <p>{mods.length} modifications registered</p>
        </div>
        {!form && (
          <button className="btn-primary" onClick={() => setForm(EMPTY)}>+ Add Modification</button>
        )}
      </div>

      {form && (
        <div style={{background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:20, marginBottom:24}}>
          <div style={{fontWeight:600, marginBottom:16, fontSize:13}}>New Modification</div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div className="field">
              <label>Canonical Name</label>
              <input value={form.canonical_name} onChange={e => set('canonical_name', e.target.value)} placeholder="e.g. Cy5" />
            </div>
            <div className="field">
              <label>Chemistry Class</label>
              <select value={form.chemistry_class} onChange={e => set('chemistry_class', e.target.value)}>
                <option value="standard">standard</option>
                <option value="ultramild">ultramild</option>
                <option value="special">special</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>Aliases (comma-separated)</label>
            <input value={form.aliases} onChange={e => set('aliases', e.target.value)} placeholder="cy5, CY5, Cyanine5" />
          </div>

          <div className="field">
            <label>Description</label>
            <input value={form.description} onChange={e => set('description', e.target.value)} />
          </div>

          <div style={{display:'flex', gap:20, marginBottom:16}}>
            {[
              ['end_5prime_ok', "5' end OK"],
              ['end_3prime_ok', "3' end OK"],
              ['internal_ok', 'Internal OK'],
              ['machine_position_required', 'Needs machine slot'],
            ].map(([key, label]) => (
              <label key={key} style={{display:'flex', alignItems:'center', gap:6, fontSize:13, textTransform:'none', letterSpacing:'normal', color:'var(--text-muted)', cursor:'pointer'}}>
                <input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} style={{width:'auto'}} />
                {label}
              </label>
            ))}
          </div>

          {saveErr && <div className="notice error">{saveErr}</div>}

          <div style={{display:'flex', gap:10}}>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Aliases</th>
            <th>Chemistry</th>
            <th>5'</th>
            <th>Int</th>
            <th>3'</th>
            <th>Slot</th>
          </tr>
        </thead>
        <tbody>
          {mods.map(m => (
            <tr key={m.id}>
              <td className="primary">{m.canonical_name}</td>
              <td style={{fontSize:11, fontFamily:'var(--mono)', color:'var(--text-dim)', maxWidth:220}}>
                {m.aliases?.join(', ')}
              </td>
              <td><span className="tag">{m.chemistry_class}</span></td>
              <td style={{color: m.end_5prime_ok ? 'var(--accent)' : 'var(--text-dim)'}}>{m.end_5prime_ok ? '✓' : '—'}</td>
              <td style={{color: m.internal_ok ? 'var(--accent)' : 'var(--text-dim)'}}>{m.internal_ok ? '✓' : '—'}</td>
              <td style={{color: m.end_3prime_ok ? 'var(--accent)' : 'var(--text-dim)'}}>{m.end_3prime_ok ? '✓' : '—'}</td>
              <td style={{color: m.machine_position_required ? 'var(--accent)' : 'var(--text-dim)'}}>{m.machine_position_required ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
