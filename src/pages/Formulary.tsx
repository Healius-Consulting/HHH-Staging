import { useState, useMemo } from 'react';
import { Search, Plus, AlertTriangle } from 'lucide-react';
import {
  useApp,
  money,
  marginPct,
  TYPE_LABELS,
  STOCK_LABELS,
  type CatalogueItem,
  type LineItem,
} from '../context/AppContext';

const TYPE_FILTERS = ['All', 'oil', 'flos', 'capsule', 'lozenge', 'vape'] as const;

export default function Formulary() {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');

  const filtered = useMemo(() => {
    let items = state.catalogue;
    if (query.trim()) {
      const q = query.toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q));
    }
    if (typeFilter !== 'All') {
      items = items.filter(i => i.type === typeFilter);
    }
    return items;
  }, [state.catalogue, query, typeFilter]);

  const stockClass = (stock: CatalogueItem['stock']) => {
    switch (stock) {
      case 'in': return 'stock-dot text-green';
      case 'low': return 'stock-dot text-amber';
      case 'out': return 'stock-dot text-red';
    }
  };

  const handleAddToRx = (item: CatalogueItem) => {
    let orderId = state.activeOrderId;
    let order = orderId != null ? state.orders.find(o => o.id === orderId) : null;

    // If no active order, create one
    if (!order) {
      dispatch({ type: 'NEW_ORDER' });
      // After dispatch the new order id will be state.nextIds.order (current value before dispatch)
      orderId = state.nextIds.order;
      // The new order will have one blank Rx with id = state.nextIds.rx
      const rxId = state.nextIds.rx;
      const lineItem: LineItem = {
        productId: item.id,
        name: item.name,
        qty: 1,
        cost: item.cost,
        retail: item.retail,
        fee: 0,
      };
      // Dispatch after a tick so new order is created
      setTimeout(() => {
        dispatch({ type: 'ADD_ITEM_TO_RX', orderId: orderId!, rxId, item: lineItem });
        dispatch({ type: 'SET_SCREEN', screen: 'create' });
      }, 0);
      return;
    }

    // Find the first prescription
    const rx = order.prescriptions[0];
    if (!rx) return;

    // Check if product already exists in the target Rx
    if (rx.items.some(li => li.productId === item.id)) {
      alert(`"${item.name}" is already in this prescription.`);
      return;
    }

    const lineItem: LineItem = {
      productId: item.id,
      name: item.name,
      qty: 1,
      cost: item.cost,
      retail: item.retail,
      fee: 0,
    };

    dispatch({ type: 'ADD_ITEM_TO_RX', orderId: order.id, rxId: rx.id, item: lineItem });
    dispatch({ type: 'SET_SCREEN', screen: 'create' });
  };

  return (
    <div className="page-body">
      <h1 className="page-title">Formulary</h1>
      <p className="page-subtitle">
        Live formulary from Curaleaf. Search for a product, check stock and price, then assign it to a patient's prescription.
      </p>

      {/* Search */}
      <div className="search-row">
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input
            className="input"
            placeholder="Search products by name…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 34 }}
          />
        </div>
        <button className="btn" onClick={() => { setQuery(''); setTypeFilter('All'); }}>Clear</button>
      </div>

      {/* Type filter chips */}
      <div className="flex items-center gap-sm" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        {TYPE_FILTERS.map(t => (
          <button
            key={t}
            className={`chip ${typeFilter === t ? 'chip-active' : ''}`}
            onClick={() => setTypeFilter(t === 'All' ? 'All' : t)}
          >
            {t === 'All' ? 'All' : TYPE_LABELS[t] || t}
          </button>
        ))}
      </div>

      {/* Product count */}
      <p className="text-sm text-muted" style={{ margin: '12px 0 8px' }}>
        {filtered.length} product{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* Product table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Type</th>
              <th>Stock</th>
              <th>Wholesale</th>
              <th>Patient Price</th>
              <th>Margin %</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">No products match your search.</div>
                </td>
              </tr>
            ) : (
              filtered.map(item => {
                const margin = marginPct(item.cost, item.retail);
                const marginCls = margin < 25 ? 'margin-warn' : 'margin-ok';
                return (
                  <tr key={item.id} className={item.stock === 'out' ? 'row-out-of-stock' : ''}>
                    <td className="font-semibold">{item.name}</td>
                    <td>{TYPE_LABELS[item.type] || item.type}</td>
                    <td>
                      <span className="flex items-center gap-sm">
                        <span className={stockClass(item.stock)} />
                        {STOCK_LABELS[item.stock]}
                      </span>
                    </td>
                    <td>{money(item.cost)}</td>
                    <td>{money(item.retail)}</td>
                    <td>
                      <span className={marginCls}>{margin}%</span>
                    </td>
                    <td>
                      <button
                        className="btn-sm btn-primary"
                        onClick={() => handleAddToRx(item)}
                      >
                        <Plus size={14} /> Add to Rx
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Margin warning banner */}
      <div className="banner-amber" style={{ marginTop: 16 }}>
        <AlertTriangle size={16} />
        <span>⚠ Items below 25% margin are flagged. Apply a £5–15 dispensing fee on the line item to protect margin.</span>
      </div>
    </div>
  );
}
