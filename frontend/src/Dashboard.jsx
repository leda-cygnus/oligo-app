import { useState } from 'react'
import { makeApi } from './api'
import SequenceEntry from './SequenceEntry'
import SequenceList from './SequenceList'
import ModificationCatalog from './ModificationCatalog'
import OrderImport from './OrderImport'
import OrderList from './OrderList'
import SynthesisRunBuilder from './SynthesisRunBuilder'
import RunList from './RunList'
import CustomerList from './CustomerList'
import MaterialLots from './MaterialLots'
import './Dashboard.css'

const TABS = [
  { id: 'import',    label: 'Import Order' },
  { id: 'sequences', label: 'Sequences' },
  { id: 'orders',    label: 'Orders' },
  { id: 'customers', label: 'Customers' },
  { id: 'build',     label: 'Run Setup' },
  { id: 'runslist',  label: 'Runs' },
  { id: 'catalog',   label: 'Modifications' },
  { id: 'materials', label: 'Materials' },
  { id: 'entry',     label: 'TEST – Enter Sequence' },
]

export default function Dashboard({ credentials, onLogout }) {
  const [tab, setTab]                         = useState('entry')
  const [targetOrderId, setTargetOrder]       = useState(null)
  const [targetCustomerId, setTargetCustomer] = useState(null)
  const api = makeApi(credentials)

  function navigateToOrder(orderId) {
    setTargetOrder(orderId)
    setTargetCustomer(null)
    setTab('orders')
  }

  function navigateToCustomerOrders(customerId) {
    setTargetCustomer(customerId)
    setTargetOrder(null)
    setTab('orders')
  }

  function handleTabClick(id) {
    if (id !== 'orders') { setTargetOrder(null); setTargetCustomer(null) }
    setTab(id)
  }

  return (
    <div className="dash">
      <header className="dash-header">
        <div className="dash-brand">
          <span className="brand-mono">5'—3'</span>
          <span className="brand-name">OligoSynth</span>
        </div>
        <nav className="dash-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => handleTabClick(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="dash-user">
          <span className="user-label">{credentials.username}</span>
          <button className="btn-ghost" onClick={onLogout}>Disconnect</button>
        </div>
      </header>

      <main className="dash-main">
        {tab === 'entry'     && <SequenceEntry       api={api} />}
        {tab === 'sequences' && <SequenceList        api={api} onNavigateToOrder={navigateToOrder} />}
        {tab === 'orders'    && <OrderList           api={api} initialOrderId={targetOrderId} initialCustomerId={targetCustomerId} />}
        {tab === 'build'     && <SynthesisRunBuilder api={api} onNavigateToRuns={() => setTab('runslist')} />}
        {tab === 'runslist'  && <RunList             api={api} />}
        {tab === 'customers' && <CustomerList        api={api} onNavigateToOrders={navigateToCustomerOrders} />}
        {tab === 'catalog'   && <ModificationCatalog api={api} />}
        {tab === 'materials' && <MaterialLots        api={api} />}
        {tab === 'import'    && <OrderImport         api={api} />}
      </main>
    </div>
  )
}
