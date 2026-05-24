import { useState, useEffect } from 'react'

const ADDR_FIELDS = [
  { key: 'building_name', label: 'Building' },
  { key: 'lab',           label: 'Lab' },
  { key: 'street',        label: 'Street' },
  { key: 'city',          label: 'City' },
  { key: 'zip',           label: 'ZIP' },
  { key: 'phone',         label: 'Phone' },
]

function AddrEditor({ order, api, onSaved }) {
  const [form, setForm]     = useState({
    building_name: order.building_name ?? '',
    lab:           order.lab           ?? '',
    street:        order.street        ?? '',
    city:          order.city          ?? '',
    zip:           order.zip           ?? '',
    phone:         order.phone         ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  async function save() {
    if (!order.customer_id) return
    setSaving(true); setErr('')
    try {
      const updated = await api.put(`/customers/${order.customer_id}`, {
        contact_name: order.contact_name || order.customer_name || '',
        company_name: order.company_name || '',
        email:        order.email        || '',
        ...form,
      })
      onSaved(updated)
    } catch {
      setErr('Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      margin: '0 0 8px 28px', padding: '12px 14px',
      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 10 }}>
        {ADDR_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 3,
                          fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {label}
            </div>
            <input style={{ width: '100%', fontSize: 13, boxSizing: 'border-box' }}
                   value={form[key]}
                   onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
          </div>
        ))}
      </div>
      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{err}</div>}
      <div style={{ textAlign: 'right' }}>
        <button className="btn-primary" style={{ fontSize: 12, padding: '4px 14px' }}
                disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save address'}
        </button>
      </div>
    </div>
  )
}

export default function ShippingLabelModal({ api, runId, onClose }) {
  const [orders, setOrders]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState('')
  const [selected, setSelected]   = useState(new Set())
  const [generating, setGen]      = useState(false)
  const [genErr, setGenErr]       = useState('')
  const [editingAddr, setEditing] = useState(null)

  useEffect(() => {
    api.get(`/runs/${runId}/orders`)
      .then(rows => {
        setOrders(rows)
        setSelected(new Set(rows.map(r => r.order_id)))
      })
      .catch(() => setErr('Failed to load orders'))
      .finally(() => setLoading(false))
  }, [runId])

  const allSelected  = orders.length > 0 && selected.size === orders.length
  const someSelected = selected.size > 0 && selected.size < orders.length

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(orders.map(r => r.order_id)))
  }

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleAddrSaved(orderId, updated) {
    setOrders(os => os.map(o =>
      o.order_id === orderId
        ? { ...o, building_name: updated.building_name, lab: updated.lab,
            street: updated.street, city: updated.city, zip: updated.zip, phone: updated.phone }
        : o
    ))
    setEditing(null)
  }

  async function generate() {
    if (!selected.size) return
    setGen(true); setGenErr('')
    try {
      const resp = await api.postRaw(`/runs/${runId}/shipping-labels`, { order_ids: [...selected] })
      if (!resp.ok) {
        const text = await resp.text()
        let msg = text
        try { msg = JSON.parse(text).error || text } catch {}
        setGenErr(`Server error: ${msg}`)
        return
      }
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `run${runId}_shipping_labels.docx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setGenErr(`Error: ${e.message}`)
    } finally {
      setGen(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 10, padding: '24px 28px',
        width: 500, maxWidth: '92vw', maxHeight: '80vh',
        boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        <h3 style={{ margin: '0 0 4px' }}>Shipping Labels — Run #{runId}</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 16px' }}>
          Select orders to include. One label per order, 2 per row.
        </p>

        {loading ? (
          <div className="notice">Loading…</div>
        ) : err ? (
          <div className="notice error">{err}</div>
        ) : orders.length === 0 ? (
          <div className="notice warn">No orders found in this run.</div>
        ) : (
          <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
            {/* Select all row */}
            <div style={{
              display: 'grid', gridTemplateColumns: '20px 1fr', alignItems: 'center',
              gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)',
              marginBottom: 4, cursor: 'pointer',
            }} onClick={toggleAll}>
              <input type="checkbox" style={{ margin: 0 }}
                     checked={allSelected}
                     ref={el => { if (el) el.indeterminate = someSelected }}
                     onChange={e => e.stopPropagation()}
                     onClick={e => { e.stopPropagation(); toggleAll() }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Select all ({orders.length} order{orders.length !== 1 ? 's' : ''})
              </span>
            </div>

            {/* Order list */}
            <div style={{ overflowY: 'auto', flex: 1, marginBottom: 16 }}>
              {orders.map(o => {
                const name      = o.contact_name || o.customer_name || '—'
                const hasAddr   = o.building_name || o.lab || o.street || o.city || o.phone
                const isEditing = editingAddr === o.order_id
                return (
                  <div key={o.order_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '20px 1fr auto',
                      alignItems: 'start', gap: 10, padding: '9px 0',
                    }}>
                      {/* checkbox */}
                      <input type="checkbox" style={{ margin: '3px 0 0' }}
                             checked={selected.has(o.order_id)}
                             onChange={() => toggle(o.order_id)} />

                      {/* content */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
                          <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                            #{o.order_ref || o.order_id}
                          </span>
                          {o.is_partial && (
                            <span className="tag" style={{ fontSize: 11,
                              background: 'rgba(245,158,11,0.12)', color: '#d97706', borderColor: '#d97706' }}>
                              partial · {o.lines_in_run}/{o.total_lines} oligos
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                          {o.company_name || ''}
                          {o.lab ? ` · ${o.lab}` : ''}
                        </div>
                        {hasAddr && (
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                            {[o.building_name, o.street, o.city].filter(Boolean).join(', ')}
                            {o.phone ? ` · ${o.phone}` : ''}
                          </div>
                        )}
                        {!hasAddr && (
                          <button className="btn-ghost"
                                  style={{ fontSize: 11, padding: '1px 8px', marginTop: 4,
                                           color: '#ef4444', borderColor: '#ef4444' }}
                                  onClick={() => setEditing(isEditing ? null : o.order_id)}>
                            {isEditing ? '✕ Cancel' : '+ Add address'}
                          </button>
                        )}
                      </div>

                      {/* edit button (only when address exists) */}
                      {hasAddr && (
                        <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                                onClick={() => setEditing(isEditing ? null : o.order_id)}>
                          {isEditing ? '✕' : 'Edit'}
                        </button>
                      )}
                    </div>

                    {isEditing && (
                      <AddrEditor order={o} api={api}
                                  onSaved={updated => handleAddrSaved(o.order_id, updated)} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {genErr && (
          <div className="notice error" style={{ marginBottom: 12, wordBreak: 'break-word' }}>
            {genErr}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary"
                  disabled={generating || !selected.size || loading}
                  onClick={generate}>
            {generating ? 'Generating…' : `↓ Generate .docx (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
