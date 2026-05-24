import { useState, useEffect, useRef, useMemo } from 'react'

const LINE_STATUS = {
  queued:             { label: 'queued',                 cls: '' },
  in_progress:        { label: 'in progress',            cls: 'rna' },
  finished:           { label: 'finished',               cls: 'done' },
  failed:             { label: 'failed',                 cls: 'error' },
  queued_resynthesis: { label: 'queued for resynthesis', cls: 'mixed' },
}

const COLS = [
  { key: 'customer_ref',  label: 'Order #' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'institute',     label: 'Institute' },
  { key: 'order_date',    label: 'Date' },
  { key: 'source',        label: 'Source' },
  { key: 'status',        label: 'Status' },
  { key: 'line_count',    label: 'Oligos' },
]

export default function OrderList({ api, initialOrderId, initialCustomerId }) {
  const [orders, setOrders]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [filter, setFilter]         = useState('')
  const [customerFilter, setCustomerFilter] = useState(initialCustomerId || null)
  const [sort, setSort]             = useState({ col: 'order_date', dir: 'desc' })
  const [expanded, setExpanded]     = useState(initialOrderId || null)
  const [detail, setDetail]         = useState(null)
  const [detailLoading, setDL]      = useState(false)

  const [menuOpen, setMenuOpen]     = useState(null)
  const menuRef                     = useRef()

  const [editOrder, setEditOrder]   = useState(null)
  const [editForm, setEditForm]     = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [editErr, setEditErr]       = useState('')

  const [deleteOrder, setDeleteOrder] = useState(null)
  const [deleting, setDeleting]       = useState(false)
  const [deleteErr, setDeleteErr]     = useState('')

  useEffect(() => {
    api.get('/orders')
      .then(setOrders)
      .catch(() => setError('Failed to load orders'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (initialOrderId) expand(initialOrderId)
  }, [initialOrderId])

  useEffect(() => {
    setCustomerFilter(initialCustomerId || null)
  }, [initialCustomerId])

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  async function expand(orderId) {
    if (expanded === orderId) { setExpanded(null); setDetail(null); return }
    setExpanded(orderId)
    setDetail(null)
    setDL(true)
    try {
      setDetail(await api.get(`/orders/${orderId}`))
    } catch {
      setDetail(null)
    } finally {
      setDL(false)
    }
  }

  function toggleSort(col) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  }

  function openEdit(o) {
    setEditOrder(o)
    setEditForm({ customer_name: o.customer_name ?? '', institute: o.institute ?? '', email: o.customer_email ?? '' })
    setEditErr('')
    setMenuOpen(null)
  }

  async function saveEdit() {
    setEditSaving(true); setEditErr('')
    try {
      await api.put(`/orders/${editOrder.id}/customer`, editForm)
      setOrders(os => os.map(o => o.id === editOrder.id
        ? { ...o, customer_name: editForm.customer_name, institute: editForm.institute, customer_email: editForm.email, customer_address: editForm.address }
        : o
      ))
      setEditOrder(null)
    } catch {
      setEditErr('Save failed.')
    } finally {
      setEditSaving(false) }
  }

  function openDelete(o) {
    setDeleteOrder(o)
    setDeleteErr('')
    setMenuOpen(null)
  }

  async function confirmDelete() {
    setDeleting(true); setDeleteErr('')
    try {
      await api.del(`/orders/${deleteOrder.id}`)
      setOrders(os => os.filter(o => o.id !== deleteOrder.id))
      if (expanded === deleteOrder.id) { setExpanded(null); setDetail(null) }
      setDeleteOrder(null)
    } catch (err) {
      setDeleteErr(err.response?.data?.error || 'Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  const displayed = useMemo(() => {
    const q = filter.toLowerCase()
    let filtered = customerFilter
      ? orders.filter(o => o.customer_id === customerFilter)
      : orders
    if (q) {
      filtered = filtered.filter(o =>
        (o.customer_ref   || '').toLowerCase().includes(q) ||
        (o.customer_name  || '').toLowerCase().includes(q) ||
        (o.customer_email || '').toLowerCase().includes(q) ||
        (o.status         || '').toLowerCase().includes(q) ||
        (o.source         || '').toLowerCase().includes(q)
      )
    }
    return [...filtered].sort((a, b) => {
      const av = a[sort.col] ?? ''
      const bv = b[sort.col] ?? ''
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [orders, filter, sort])

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
  if (error)   return <div className="notice error">{error}</div>

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Orders</h2>
          <p>{displayed.length}{displayed.length !== orders.length ? ` of ${orders.length}` : ''} order{orders.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {customerFilter && (
            <button
              className="btn-ghost"
              style={{ fontSize: 12, padding: '3px 10px', whiteSpace: 'nowrap' }}
              onClick={() => setCustomerFilter(null)}>
              Customer filter ✕
            </button>
          )}
          <input
            className="filter-input"
            placeholder="Filter by order #, customer, status…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="notice warn">No orders yet. Use "Import Order" to add one.</div>
      ) : (
        <table>
          <thead>
            <tr>
              {COLS.map(c => (
                <th key={c.key}
                    onClick={() => toggleSort(c.key)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  {c.label}{' '}
                  {sort.col === c.key
                    ? (sort.dir === 'asc' ? '↑' : '↓')
                    : <span style={{ opacity: 0.3 }}>↕</span>}
                </th>
              ))}
              <th style={{ width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {displayed.flatMap(o => {
              const isOpen = expanded === o.id
              const rows = [
                <tr key={o.id}
                    style={{ cursor: 'pointer', background: isOpen ? 'var(--surface)' : '' }}
                    onClick={() => expand(o.id)}>
                  <td className="mono primary">{o.customer_ref ?? '—'}</td>
                  <td>{o.customer_name ?? '—'}</td>
                  <td>{o.institute ?? '—'}</td>
                  <td className="mono">{o.order_date ?? '—'}</td>
                  <td><span className="tag">{o.source}</span></td>
                  <td>
                    <span className="tag">{o.status}</span>
                    {o.status === 'in_progress' && o.active_run_id && (
                      <span className="mono" style={{ marginLeft: 6, fontSize: '0.85em', opacity: 0.65 }}>
                        Run #{o.active_run_id}
                      </span>
                    )}
                  </td>
                  <td className="mono">{o.line_count}</td>
                  <td style={{ position: 'relative', width: 32, padding: '0 4px' }}
                      onClick={e => e.stopPropagation()}>
                    <button
                      className="btn-ghost"
                      style={{ padding: '2px 8px', fontSize: 16, lineHeight: 1 }}
                      onClick={() => setMenuOpen(menuOpen === o.id ? null : o.id)}>
                      ⋮
                    </button>
                    {menuOpen === o.id && (
                      <div ref={menuRef}
                           style={{
                             position: 'absolute', right: 0, top: '100%', zIndex: 100,
                             background: 'var(--surface)', border: '1px solid var(--border)',
                             borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                             minWidth: 160, padding: '4px 0',
                           }}>
                        <button className="btn-ghost"
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', borderRadius: 0 }}
                                onClick={() => openEdit(o)}>
                          Edit customer info
                        </button>
                        <button className="btn-ghost"
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', borderRadius: 0, color: '#ef4444' }}
                                onClick={() => openDelete(o)}>
                          Delete order
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ]
              if (isOpen) {
                rows.push(
                  <tr key={o.id + '-d'} style={{ background: 'var(--surface)' }}>
                    <td colSpan={8} style={{ padding: '0 0 12px 0' }}>
                      {detailLoading ? (
                        <div style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>Loading…</div>
                      ) : detail?.lines?.length ? (
                        <table style={{ margin: '4px 16px 0', width: 'calc(100% - 32px)', fontSize: 13 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 32 }}>#</th>
                              <th>Name</th>
                              <th>Type</th>
                              <th>Sequence</th>
                              <th>Scale</th>
                              <th>Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.lines.map(l => (
                              <>
                                <tr key={l.id}>
                                  <td className="mono">{l.line_number}</td>
                                  <td className="primary">
                                    {l.oligo_name ?? l.customer_label ?? '—'}
                                    {l.line_status && LINE_STATUS[l.line_status] && (
                                      <span className={`tag ${LINE_STATUS[l.line_status].cls}`}
                                            style={{ marginLeft: 6, verticalAlign: 'middle', fontSize: 10 }}>
                                        {LINE_STATUS[l.line_status].label}
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    <span className={`tag ${l.oligo_type === 'DNA' ? '' : 'rna'}`}>
                                      {l.oligo_type ?? '—'}
                                    </span>
                                  </td>
                                  <td className="mono" style={{ fontSize: 12, letterSpacing: '0.03em' }}>
                                    {l.annotated_sequence}
                                  </td>
                                  <td className="mono">{l.quantity_nmol != null ? `${l.quantity_nmol} nmol` : '—'}</td>
                                  <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>{l.notes ?? '—'}</td>
                                </tr>
                                {l.researcher && (
                                  <tr key={l.id + '-r'} style={{ background: 'var(--bg)' }}>
                                    <td />
                                    <td colSpan={5} style={{ fontSize: 11, color: 'var(--text-muted)', paddingTop: 0, paddingBottom: 6 }}>
                                      Researcher: <strong>{l.researcher}</strong>
                                    </td>
                                  </tr>
                                )}
                              </>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>No lines found.</div>
                      )}
                    </td>
                  </tr>
                )
              }
              return rows
            })}
          </tbody>
        </table>
      )}

      {/* Edit modal */}
      {editOrder && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }} onClick={() => setEditOrder(null)}>
          <div style={{
            background: 'var(--surface)', borderRadius: 10, padding: 28,
            minWidth: 360, maxWidth: 480, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 18 }}>Edit customer — Order #{editOrder.customer_ref}</h3>
            <div className="field">
              <label>Customer name</label>
              <input value={editForm.customer_name}
                     onChange={e => setEditForm(f => ({ ...f, customer_name: e.target.value }))} />
            </div>
            <div className="field">
              <label>Institute</label>
              <input value={editForm.institute}
                     onChange={e => setEditForm(f => ({ ...f, institute: e.target.value }))} />
            </div>
            <div className="field">
              <label>Email</label>
              <input value={editForm.email}
                     onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
            </div>

            {editErr && <div className="notice error" style={{ marginBottom: 12 }}>{editErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn-ghost" onClick={() => setEditOrder(null)}>Cancel</button>
              <button className="btn-primary" disabled={editSaving} onClick={saveEdit}>
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteOrder && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }} onClick={() => setDeleteOrder(null)}>
          <div style={{
            background: 'var(--surface)', borderRadius: 10, padding: 28,
            minWidth: 320, maxWidth: 440, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 10 }}>Delete order #{deleteOrder.customer_ref}?</h3>
            <p style={{ color: 'var(--text-dim)', marginBottom: 18 }}>
              This will permanently remove the order and its {deleteOrder.line_count} oligo{deleteOrder.line_count !== 1 ? 's' : ''}.
              This cannot be undone.
            </p>
            {deleteErr && <div className="notice error" style={{ marginBottom: 12 }}>{deleteErr}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setDeleteOrder(null)}>Cancel</button>
              <button className="btn-primary"
                      style={{ background: '#ef4444', borderColor: '#ef4444' }}
                      disabled={deleting}
                      onClick={confirmDelete}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
