import { useMemo, useState, type CSSProperties } from 'react';
import { CircleDollarSign, Package, Search, ShieldCheck, Tags } from 'lucide-react';
import ProviderStatusNotice from '../components/ProviderStatusNotice';
import { money, TYPE_LABELS, useApp } from '../context/AppContext';

const TYPE_FILTERS = ['All', 'oil', 'flos', 'capsule', 'lozenge', 'vape', 'other'] as const;

export default function FormularyPricing() {
  const { state } = useApp();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');

  const products = useMemo(() => state.catalogue.filter(product => {
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || `${product.name} ${product.unit ?? ''}`.toLowerCase().includes(needle);
    return matchesQuery && (typeFilter === 'All' || product.type === typeFilter);
  }), [query, state.catalogue, typeFilter]);

  const activeCount = state.catalogue.filter(product => product.supplierState === 'ACTIVE').length;
  const pricedCount = state.catalogue.filter(product => product.retail > 0).length;
  const updatedAt = state.catalogueUpdatedAt
    ? new Date(state.catalogueUpdatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="page-body formulary-pricing-workspace">
      <section className="pricing-brief pricing-brief--readonly">
        <div className="pricing-brief__copy">
          <span className="pricing-brief__icon"><ShieldCheck size={18} /></span>
          <span>
            <small>Curaleaf-managed catalogue</small>
            <strong>Recommended patient prices are supplied by Curaleaf and are read-only.</strong>
            <em>Wholesale cost and stock availability are confirmed for the selected pack quantities when a quote is requested in the prescription workspace.</em>
          </span>
        </div>
        <dl className="pricing-position" aria-label="Curaleaf catalogue position">
          <div><dt>Products</dt><dd>{state.catalogue.length}</dd></div>
          <div><dt>Active</dt><dd>{activeCount}</dd></div>
          <div><dt>Recommended patient prices</dt><dd>{pricedCount}</dd></div>
        </dl>
      </section>

      {state.catalogueLoading ? (
        <ProviderStatusNotice state="loading" title="Refreshing Curaleaf catalogue" detail="The latest products and recommended patient prices are being retrieved." />
      ) : state.catalogueError ? (
        <ProviderStatusNotice
          title="Curaleaf information is temporarily delayed"
          detail="You can wait and try again later. If this continues, contact your HHH administrator; pharmacy staff do not need to change any connection settings."
        />
      ) : state.catalogueSource === 'curaleaf' ? (
        <ProviderStatusNotice
          state="available"
          title="Catalogue connected"
          detail={updatedAt ? `Last refreshed ${updatedAt}. Curaleaf remains the source of patient pricing.` : 'Curaleaf remains the source of patient pricing.'}
        />
      ) : (
        <ProviderStatusNotice
          title="Catalogue has not loaded"
          detail="Wait and refresh this page. If it remains unavailable, contact your HHH administrator; pharmacy staff do not need to change any connection settings."
        />
      )}

      <section className="pricing-ledger">
        <header className="pricing-ledger__header">
          <div>
            <small>Curaleaf catalogue</small>
            <strong>{state.catalogue.length} product{state.catalogue.length === 1 ? '' : 's'} loaded</strong>
          </div>
          <label className="pricing-search">
            <Search size={15} />
            <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search product or strength" aria-label="Search Curaleaf catalogue" />
          </label>
        </header>

        <div className="pricing-type-filter" role="group" aria-label="Filter formulary by type">
          {TYPE_FILTERS.map(type => (
            <button type="button" key={type} aria-pressed={typeFilter === type} onClick={() => setTypeFilter(type)}>
              {type === 'All' ? 'All products' : TYPE_LABELS[type] || type}
            </button>
          ))}
        </div>

        <div className="pricing-table pricing-table--readonly" role="table" aria-label="Curaleaf products and recommended patient prices">
          <div className="pricing-table__head" role="row">
            <span role="columnheader">Product</span>
            <span role="columnheader">Pack</span>
            <span role="columnheader">Product state</span>
            <span role="columnheader">Recommended patient price</span>
            <span role="columnheader">Wholesale</span>
          </div>
          {products.length === 0 ? (
            <div className="pricing-empty">
              <Search size={20} />
              <span><strong>No products match</strong><small>Change the search or product type.</small></span>
            </div>
          ) : products.map((product, index) => (
            <div className="pricing-row pricing-row--readonly" role="row" key={product.id} style={{ '--stagger-index': index } as CSSProperties}>
              <span className="pricing-product" role="cell">
                <strong>{product.name}</strong>
                <small><Tags size={12} /> {TYPE_LABELS[product.type] || product.type}</small>
              </span>
              <span className="pricing-pack" role="cell">
                <Package size={14} />
                <span><strong>{product.packSize ?? '—'} {product.unit ?? 'units'}</strong><small>Curaleaf pack size</small></span>
              </span>
              <span className={`pricing-stock ${product.supplierState === 'ACTIVE' ? 'stock-in' : 'stock-out'}`} role="cell">
                <i aria-hidden="true" />{product.supplierState === 'ACTIVE' ? 'Active' : 'Unavailable'}
              </span>
              <span className="pricing-patient-price" role="cell">
                <CircleDollarSign size={14} />
                <span><strong>{product.retail > 0 ? money(product.retail) : 'Not supplied'}</strong><small>{product.retail > 0 ? 'Set by Curaleaf' : 'Awaiting Curaleaf price'}</small></span>
              </span>
              <span className="pricing-cost" role="cell">
                <small>Order-specific</small>
                <strong>Confirmed by quote</strong>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
