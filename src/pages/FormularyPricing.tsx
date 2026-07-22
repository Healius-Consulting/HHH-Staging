import { useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, CheckCircle, Percent, RotateCcw, Search, Tags } from 'lucide-react';
import { marginPct, money, STOCK_LABELS, TYPE_LABELS, useApp } from '../context/AppContext';
import { isApiConfigured, updateFormularyPrices } from '../shared/api';
import type { UpdateFormularyPriceInput } from '../shared/contracts';

const TYPE_FILTERS = ['All', 'oil', 'flos', 'capsule', 'lozenge', 'vape'] as const;

export default function FormularyPricing() {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [markupPreset, setMarkupPreset] = useState(25);
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const overrides = state.formularyPrices[organisation.id] ?? {};
  const effectivePrice = (productId: string, guidePrice: number) => overrides[productId] ?? guidePrice;

  const products = useMemo(() => state.catalogue.filter(product => {
    const matchesQuery = !query.trim() || product.name.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (typeFilter === 'All' || product.type === typeFilter);
  }), [query, state.catalogue, typeFilter]);

  const customPriceCount = Object.keys(overrides).length;
  const margins = state.catalogue.map(product => marginPct(product.cost, effectivePrice(product.id, product.retail)));
  const averageMargin = margins.length ? Math.round(margins.reduce((total, margin) => total + margin, 0) / margins.length) : 0;
  const belowTarget = margins.filter(margin => margin < 25).length;

  const setPrice = (productId: string, retail: number | null) => dispatch({
    type: 'SET_FORMULARY_PRICE',
    organisationId: organisation.id,
    productId,
    retail,
  });

  const persistPrices = async (prices: UpdateFormularyPriceInput[]) => {
    if (state.workspaceMode !== 'live' || !isApiConfigured) return;
    try {
      await updateFormularyPrices(organisation.id, prices);
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Pricing could not be saved.', toastType: 'error' });
    }
  };

  const applyMarkup = (markup: number) => {
    const prices = products.map(product => ({ productId: product.id, patientPricePence: Math.round(product.cost * (1 + markup / 100) * 100) }));
    prices.forEach(price => setPrice(price.productId, price.patientPricePence / 100));
    void persistPrices(prices);
    dispatch({ type: 'ADD_TOAST', message: `${markup}% markup applied to ${products.length} visible product${products.length === 1 ? '' : 's'}.`, toastType: 'success' });
  };

  const restoreGuidePrices = () => {
    products.forEach(product => setPrice(product.id, null));
    void persistPrices(products.map(product => ({ productId: product.id, patientPricePence: null })));
    dispatch({ type: 'ADD_TOAST', message: `Guide prices restored for ${products.length} visible product${products.length === 1 ? '' : 's'}.`, toastType: 'info' });
  };

  return (
    <div className="page-body formulary-pricing-workspace">
      <section className="pricing-brief">
        <div className="pricing-brief__copy">
          <span className="pricing-brief__icon"><Tags size={18} /></span>
          <span><small>Pharmacy pricing</small><strong>Curaleaf supplies WX. {organisation.tradingName} controls PX.</strong><em>New prescription lines use these prices automatically. Existing paid orders retain the price originally charged.</em></span>
        </div>
        <dl className="pricing-position" aria-label="Formulary pricing position">
          <div><dt>Custom prices</dt><dd>{customPriceCount}</dd></div>
          <div><dt>Average margin</dt><dd>{averageMargin}%</dd></div>
          <div className={belowTarget ? 'attention' : ''}><dt>Below 25%</dt><dd>{belowTarget}</dd></div>
        </dl>
      </section>

      <section className="pricing-ledger">
        <header className="pricing-ledger__header">
          <div><small>Active catalogue</small><strong>{state.catalogue.length} products available to this pharmacy</strong></div>
          <label className="pricing-search"><Search size={15} /><input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search product or strength" aria-label="Search pharmacy formulary" /></label>
        </header>
        <div className="pricing-type-filter" role="group" aria-label="Filter formulary by type">
          {TYPE_FILTERS.map(type => <button type="button" key={type} aria-pressed={typeFilter === type} onClick={() => setTypeFilter(type)}>{type === 'All' ? 'All products' : TYPE_LABELS[type] || type}</button>)}
        </div>

        <div className="pricing-markup-tools">
          <div className="pricing-markup-tools__copy"><span className="pricing-markup-tools__icon"><Percent size={15} /></span><span><strong>Bulk markup</strong><small>Apply a percentage above Curaleaf cost to the {products.length} products currently shown.</small></span></div>
          <div className="pricing-markup-presets" role="group" aria-label="Select markup percentage">{[15, 25, 35, 50].map(markup => <button type="button" key={markup} aria-pressed={markupPreset === markup} onClick={() => setMarkupPreset(markup)}>{markup}%</button>)}<label><span className="sr-only">Custom markup percentage</span><input type="number" min="0" max="500" value={markupPreset} onChange={event => setMarkupPreset(Math.max(0, Math.min(500, Number(event.target.value))))} /><span>%</span></label></div>
          <button type="button" className="btn btn-sm btn-primary" disabled={!products.length} onClick={() => applyMarkup(markupPreset)}>Apply to {products.length} shown</button>
          <div className="pricing-reset-actions"><button type="button" className="btn btn-sm" disabled={!products.length} onClick={() => applyMarkup(0)}>Match Curaleaf cost</button><button type="button" className="btn btn-sm" disabled={!products.length} onClick={restoreGuidePrices}><RotateCcw size={13} /> Restore guide prices</button></div>
        </div>

        <div className="pricing-table" role="table" aria-label="Pharmacy formulary prices">
          <div className="pricing-table__head" role="row">
            <span role="columnheader">Product</span>
            <span role="columnheader">Availability</span>
            <span role="columnheader">WX</span>
            <span role="columnheader">PX</span>
            <span role="columnheader">Markup</span>
            <span role="columnheader">Margin</span>
            <span role="columnheader"><span className="sr-only">Pricing action</span></span>
          </div>
          {products.length === 0 ? (
            <div className="pricing-empty"><Search size={20} /><span><strong>No products match</strong><small>Change the search or product type.</small></span></div>
          ) : products.map((product, index) => {
            const patientPrice = effectivePrice(product.id, product.retail);
            const margin = marginPct(product.cost, patientPrice);
            const markup = product.cost > 0 ? Number((((patientPrice - product.cost) / product.cost) * 100).toFixed(1)) : 0;
            const custom = overrides[product.id] !== undefined;
            const lowMargin = margin < 25;
            const setMarkup = (value: number) => setPrice(product.id, Number((product.cost * (1 + Math.max(0, value) / 100)).toFixed(2)));
            const persistMarkup = (value: number) => void persistPrices([{ productId: product.id, patientPricePence: Math.round(product.cost * (1 + Math.max(0, value) / 100) * 100) }]);
            return (
              <div className="pricing-row" role="row" key={product.id} style={{ '--stagger-index': index } as CSSProperties}>
                <span className="pricing-product" role="cell"><strong>{product.name}</strong><small>{TYPE_LABELS[product.type] || product.type}{custom && <em>Custom price</em>}</small></span>
                <span className={`pricing-stock stock-${product.stock}`} role="cell"><i aria-hidden="true" />{STOCK_LABELS[product.stock]}</span>
                <span className="pricing-cost" role="cell"><small>Curaleaf cost</small><strong>{money(product.cost)}</strong></span>
                <label className="pricing-input" role="cell"><small>PX</small><span className="pricing-input-control"><span>£</span><input type="number" min="0" step="0.01" value={patientPrice} onFocus={event => event.currentTarget.select()} onChange={event => setPrice(product.id, Math.max(0, Number(event.target.value)))} onBlur={event => void persistPrices([{ productId: product.id, patientPricePence: Math.round(Math.max(0, Number(event.target.value)) * 100) }])} aria-label={`PX for ${product.name}`} /></span></label>
                <label className="pricing-product-markup" role="cell"><small>Markup</small><span className="pricing-markup-control"><input type="number" min="0" max="500" step="1" value={markup} onFocus={event => event.currentTarget.select()} onChange={event => setMarkup(Math.min(500, Number(event.target.value)))} onBlur={event => persistMarkup(Math.min(500, Number(event.target.value)))} aria-label={`Markup percentage for ${product.name}`} /><span>%</span></span></label>
                <span className={`pricing-margin${lowMargin ? ' low' : ''}`} role="cell">{lowMargin ? <AlertTriangle size={13} /> : <CheckCircle size={13} />}<span><strong>{margin}% margin</strong><small>{money(Math.max(0, patientPrice - product.cost))} gross per unit</small></span></span>
                <span className="pricing-action" role="cell">{custom ? <button type="button" className="icon-button" aria-label={`Reset ${product.name} to guide price ${money(product.retail)}`} title={`Reset to ${money(product.retail)}`} onClick={() => { setPrice(product.id, null); void persistPrices([{ productId: product.id, patientPricePence: null }]); }}><RotateCcw size={14} /></button> : <span className="pricing-guide">Guide</span>}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
