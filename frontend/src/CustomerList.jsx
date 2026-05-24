import { useState, useEffect } from 'react'

const ADDR_FIELDS = [
  { key: 'building_name', label: 'Building' },
  { key: 'lab',           label: 'Lab' },
  { key: 'street',        label: 'Street' },
  { key: 'city',          label: 'City' },
  { key: 'zip',           label: 'ZIP' },
  { key: 'phone',         label: 'Phone' },
]

function formatAddress(c) {
  return [c.street, c.city, c.zip].filter(Boolean).join(', ') || null
}

export default function CustomerList({ api, onNavigateToOrders }) {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState('')
  const [editId, setEditId]       = useState(null)
  const [form, setForm]           = useState({})
  const [saving, setSaving]       = useState(false)
  const [saveErr, setSaveErr]     = useState('')

  useEffect(() => {
    api.get('/customers')
      .then(setCustomers)
      .catch(() => setErr('Failed to load customers'))
      .finally(() => setLoading(false))
  }, [])

  function openEdit(c) {
    setEditId(c.id)
    setForm({
      contact_name:  c.contact_name  ?? '',
      company_name:  c.company_name  ?? '',
      email:         c.email         ?? '',
      building_name: c.building_name ?? '',
      lab:           c.lab           ?? '',
      street:        c.street        ?? '',
      city:          c.city          ?? '',
      zip:           c.zip           ?? '',
      phone:         c.phone         ?? '',
    })
    setSaveErr('')
  }

  async function saveEdit() {
    setSaving(true); setSaveErr('')
    try {
      const updated = await api.put(`/customers/${editId}`, form)
      setCustomers(cs => cs.map(c => c.id === editId ? { ...c, ...updated } : c))
      setEditId(null)
    } catch {
      setSaveErr('Save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="notice">Loading…</div>
  if (err)     return <div className="notice error">{err}</div>

  return (
    <div className="rl">
      <div className="section-head">
        <div>
          <h2>Customers</h2>
          <p>{customers.length} customer{customers.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {customers.length === 0
        ? <div className="notice warn">No customers yet. They are created automatically when importing orders.</div>
        : (
          <table className="rl-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Company / Institute</th>
                <th>Email</th>
                <th>Address</th>
                <th style={{ width: 48 }}>Orders</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id}>
                  <td className="primary">{c.contact_name || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                  <td>{c.company_name || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{c.email || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatAddress(c) || <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                  <td className="mono" style={{ textAlign: 'center' }}>
                    {onNavigateToOrders
                      ? (
                        <button
                          className="btn-ghost"
                          style={{ fontSize: 13, padding: '1px 8px', minWidth: 28 }}
                          onClick={() => onNavigateToOrders(c.id)}
                        >
                          {c.order_count}
                        </button>
                      )
                      : c.order_count
                    }
                  </td>
                  <td>
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }}
                            onClick={() => openEdit(c)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      {editId !== null && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }} onClick={() => setEditId(null)}>
          <div style={{
            background: 'var(--surface)', borderRadius: 10, padding: 28,
            minWidth: 360, maxWidth: 500, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 18 }}>Edit customer</h3>

            {[
              { key: 'contact_name', label: 'Contact name' },
              { key: 'company_name', label: 'Company / Institute' },
              { key: 'email',        label: 'Email' },
            ].map(({ key, label }) => (
              <div key={key} className="field" style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4, display: 'block' }}>{label}</label>
                <input
                  style={{ width: '100%' }}
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}

            <div style={{ marginTop: 16, marginBottom: 8, fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Address
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 12 }}>
              {ADDR_FIELDS.map(({ key, label }) => (
                <div key={key} className="field">
                  <label style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 3, display: 'block' }}>{label}</label>
                  <input
                    style={{ width: '100%' }}
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
            </div>

            {saveErr && <div className="notice error" style={{ marginBottom: 12 }}>{saveErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
              <button className="btn-primary" disabled={saving} onClick={saveEdit}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
