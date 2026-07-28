import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Boxes, FlaskConical, Package, RefreshCw, Search } from 'lucide-react';
import { getDevCuraleafCatalogue } from '../shared/api';
import type { CuraleafDevCatalogue } from '../shared/contracts';

type CatalogueTab = 'formulas' | 'products';

const pounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export default function CuraleafCatalogPreview() {
  const [catalogue, setCatalogue] = useState<CuraleafDevCatalogue | null>(null);
  const [tab, setTab] = useState<CatalogueTab>('formulas');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalogue(await getDevCuraleafCatalogue());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The Curaleaf catalogue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const normalizedQuery = query.trim().toLowerCase();
  const formulas = useMemo(() => (catalogue?.formulas ?? []).filter(formula =>
    !normalizedQuery || [formula.printedName, formula.formulaForm, formula.unit, formula.id].some(value => value?.toLowerCase().includes(normalizedQuery))
  ), [catalogue, normalizedQuery]);
  const products = useMemo(() => (catalogue?.products ?? []).filter(product =>
    !normalizedQuery || [product.formulaName, product.formulaUnit, product.formulaId, product.id].some(value => value?.toLowerCase().includes(normalizedQuery))
  ), [catalogue, normalizedQuery]);

  return (
    <main className="curaleaf-catalog-preview">
      <header className="catalog-preview-header">
        <div className="catalog-preview-brand">
          <span className="catalog-preview-mark"><FlaskConical size={23} /></span>
          <span><small>Local developer view</small><strong>Curaleaf catalogue</strong></span>
        </div>
        <div className="catalog-preview-status">
          <span><i /> Sandbox connected</span>
          {catalogue && <time dateTime={catalogue.fetchedAt}>Updated {new Date(catalogue.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>}
          <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>
        </div>
      </header>

      <section className="catalog-preview-shell">
        <div className="catalog-preview-intro">
          <div><small>api.curaleaflaboratories.dev</small><h1>Formulas and products</h1><p>Live sandbox catalogue data fetched server-side with the read-only test credential.</p></div>
          <div className="catalog-preview-metrics">
            <span><FlaskConical size={17} /><small>Formulas</small><strong>{catalogue?.formulaTotal ?? '—'}</strong></span>
            <span><Package size={17} /><small>Products</small><strong>{catalogue?.productTotal ?? '—'}</strong></span>
          </div>
        </div>

        <div className="catalog-preview-toolbar">
          <div className="catalog-preview-tabs" role="tablist" aria-label="Catalogue type">
            <button type="button" role="tab" aria-selected={tab === 'formulas'} onClick={() => setTab('formulas')}><FlaskConical size={15} /> Formulas <span>{catalogue?.formulaTotal ?? 0}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'products'} onClick={() => setTab('products')}><Package size={15} /> Products <span>{catalogue?.productTotal ?? 0}</span></button>
          </div>
          <label className="catalog-preview-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${tab}`} aria-label={`Search ${tab}`} /></label>
        </div>

        {error ? (
          <div className="catalog-preview-message error"><AlertCircle size={22} /><span><strong>Catalogue unavailable</strong><small>{error}</small></span><button type="button" onClick={() => void load()}>Try again</button></div>
        ) : loading && !catalogue ? (
          <div className="catalog-preview-message"><RefreshCw size={22} className="spin" /><span><strong>Loading sandbox catalogue</strong><small>Fetching formulas and products from Curaleaf…</small></span></div>
        ) : tab === 'formulas' ? (
          <section className="catalog-preview-table" aria-label="Curaleaf formulas">
            <div className="catalog-preview-row head"><span>Formula</span><span>Form</span><span>Unit</span><span>State</span><span>ID</span></div>
            {formulas.map(formula => <div className="catalog-preview-row" key={formula.id}><span><FlaskConical size={15} /><strong>{formula.printedName}</strong></span><span>{formula.formulaForm}</span><span>{formula.unit}</span><span><em className={`catalog-state ${formula.state.toLowerCase()}`}>{formula.state}</em></span><span><code>{formula.id}</code></span></div>)}
            {!formulas.length && <div className="catalog-preview-empty"><Search size={20} /> No formulas match “{query}”.</div>}
          </section>
        ) : (
          <section className="catalog-preview-table products" aria-label="Curaleaf products">
            <div className="catalog-preview-row head"><span>Product</span><span>Stock</span><span>Patient pack price</span><span>State</span><span>ID</span></div>
            {products.map(product => <div className="catalog-preview-row" key={product.id}><span><Package size={15} /><strong>{product.formulaName}</strong><small>{product.formulaUnit} · Formula {product.formulaId}</small></span><span><strong>{product.quantity} {product.formulaUnit}</strong><small>pack size</small></span><span><strong>{pounds.format(Number(product.patientPackPrice) || 0)}</strong></span><span><em className={`catalog-state ${product.state.toLowerCase()}`}>{product.state}</em></span><span><code>{product.id}</code></span></div>)}
            {!products.length && <div className="catalog-preview-empty"><Search size={20} /> No products match “{query}”.</div>}
          </section>
        )}
        <footer className="catalog-preview-footer"><Boxes size={15} /> Showing {tab === 'formulas' ? formulas.length : products.length} of {tab === 'formulas' ? catalogue?.formulaTotal ?? 0 : catalogue?.productTotal ?? 0} {tab}.</footer>
      </section>
    </main>
  );
}
