import { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Minus, Package, Plus, Search, Stethoscope, Trash2 } from 'lucide-react';
import type { CatalogueItem, LineItem, Prescription } from '../context/AppContext';
import { money } from '../context/AppContext';
import './ManualPrescriptionEditor.css';

type MetadataField = 'issueDate' | 'prescriberPin' | 'prescriberGmcNumber' | 'prescriberGphcNumber';

export type ManualPrescriptionEditorView = 'details' | 'formulary' | 'all';
type CatalogueTypeFilter = 'all' | CatalogueItem['type'];

const catalogueTypeLabels: Record<CatalogueItem['type'], string> = {
  oil: 'Oil',
  flos: 'Flower',
  capsule: 'Capsule',
  lozenge: 'Lozenge',
  vape: 'Vape',
  other: 'Other',
};

const dateParts = (value?: string) => {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { day: match[3], month: match[2], year: match[1] } : { day: '', month: '', year: '' };
};

function ManualDateField({ label, value, onChange }: { label: string; value?: string; onChange: (value: string) => void }) {
  const initial = dateParts(value);
  const [day, setDay] = useState(initial.day);
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);

  useEffect(() => {
    const next = dateParts(value);
    setDay(next.day);
    setMonth(next.month);
    setYear(next.year);
  }, [value]);

  const commit = (nextDay: string, nextMonth: string, nextYear: string) => {
    if (!nextDay && !nextMonth && !nextYear) {
      onChange('');
      return;
    }
    if (nextDay.length !== 2 || nextMonth.length !== 2 || nextYear.length !== 4) return;
    const dayNumber = Number(nextDay);
    const monthNumber = Number(nextMonth);
    const yearNumber = Number(nextYear);
    const candidate = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
    if (candidate.getUTCFullYear() === yearNumber && candidate.getUTCMonth() === monthNumber - 1 && candidate.getUTCDate() === dayNumber) {
      onChange(`${nextYear}-${nextMonth}-${nextDay}`);
    }
  };

  const updatePart = (part: 'day' | 'month' | 'year', rawValue: string) => {
    const limit = part === 'year' ? 4 : 2;
    const nextValue = rawValue.replace(/\D/g, '').slice(0, limit);
    const nextDay = part === 'day' ? nextValue : day;
    const nextMonth = part === 'month' ? nextValue : month;
    const nextYear = part === 'year' ? nextValue : year;
    if (part === 'day') setDay(nextValue);
    if (part === 'month') setMonth(nextValue);
    if (part === 'year') setYear(nextValue);
    commit(nextDay, nextMonth, nextYear);
  };

  return (
    <label className="manual-rx-date-label">
      <span>{label}</span>
      <span className="manual-rx-date-field" role="group" aria-label={label}>
        <input aria-label={`${label} day`} inputMode="numeric" placeholder="DD" value={day} onChange={event => updatePart('day', event.target.value)} />
        <i>/</i>
        <input aria-label={`${label} month`} inputMode="numeric" placeholder="MM" value={month} onChange={event => updatePart('month', event.target.value)} />
        <i>/</i>
        <input aria-label={`${label} year`} inputMode="numeric" placeholder="YYYY" value={year} onChange={event => updatePart('year', event.target.value)} />
      </span>
    </label>
  );
}

export default function ManualPrescriptionEditor({
  prescription,
  catalogue,
  view = 'all',
  onPrescriberChange,
  onMetadataChange,
  onAddItem,
  onRemoveItem,
  onUpdateQuantity,
  onUpdateUnits,
}: {
  prescription: Prescription;
  catalogue: CatalogueItem[];
  view?: ManualPrescriptionEditorView;
  onPrescriberChange: (value: string) => void;
  onMetadataChange: (field: MetadataField, value: string) => void;
  onAddItem: (item: LineItem) => void;
  onRemoveItem: (productId: string) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onUpdateUnits: (productId: string, units: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<CatalogueTypeFilter>('all');
  const selectedProductIds = useMemo(() => new Set(prescription.items.map(item => item.productId)), [prescription.items]);
  const activeProducts = useMemo(
    () => catalogue.filter(product => product.supplierState === 'ACTIVE' && product.formulaId),
    [catalogue],
  );
  const availableTypes = useMemo(
    () => [...new Set(activeProducts.map(product => product.type))],
    [activeProducts],
  );
  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('en-GB');
    return activeProducts
      .filter(product => typeFilter === 'all' || product.type === typeFilter)
      .filter(product => !needle || `${product.name} ${product.type} ${product.unit ?? ''}`.toLocaleLowerCase('en-GB').includes(needle));
  }, [activeProducts, query, typeFilter]);
  const visibleProducts = filteredProducts.slice(0, 16);

  const addProduct = (product: CatalogueItem) => {
    if (selectedProductIds.has(product.id)) return;
    onAddItem({
      productId: product.id,
      formulaId: product.formulaId,
      name: product.name,
      qty: 1,
      unitsNeededCount: product.packSize ?? 1,
      cost: null,
      retail: product.retail,
    });
  };

  const updatePackQuantity = (item: LineItem, nextQuantity: number) => {
    const quantity = Math.max(1, Math.min(100, Math.floor(nextQuantity) || 1));
    const product = catalogue.find(candidate => candidate.id === item.productId);
    const currentPackSize = item.unitsNeededCount && item.qty ? item.unitsNeededCount / item.qty : 1;
    const packSize = product?.packSize ?? currentPackSize;
    onUpdateQuantity(item.productId, quantity);
    onUpdateUnits(item.productId, Math.max(1, Math.round(packSize * quantity)));
  };

  return (
    <div className="manual-rx-editor">
      {view !== 'formulary' ? (
        <div className="manual-rx-details">
          <header className="manual-rx-details__header">
            <span><small>Manual transcription</small><strong>Complete only what is printed on the prescription</strong></span>
            <small>Patient details come from the approved patient selected in Step 1.</small>
          </header>

          <section className="manual-rx-field-group">
            <header><FileText size={15} /><span><small>Section 1</small><strong>Prescription dates</strong><em>Issue date and 28-day expiry</em></span></header>
            <div className="manual-rx-fields">
              <ManualDateField label="Issue date" value={prescription.issueDate} onChange={issueDate => onMetadataChange('issueDate', issueDate)} />
              {prescription.issueDate ? (
                <label>
                  <span>Derived 28-day expiry</span>
                  <input className="input" disabled value={new Date(new Date(prescription.issueDate).setDate(new Date(prescription.issueDate).getDate() + 28)).toISOString().split('T')[0]} />
                </label>
              ) : null}
            </div>
          </section>


          <section className="manual-rx-field-group">
            <header><Stethoscope size={15} /><span><small>Section 2</small><strong>Prescriber verification</strong><em>Name, PIN and registration</em></span></header>
            <div className="manual-rx-fields manual-rx-fields--prescriber">
              <label className="manual-rx-fields__wide">
                <span>Prescriber’s full name</span>
                <input className="input" value={prescription.prescriber} maxLength={200} onChange={event => onPrescriberChange(event.target.value)} />
              </label>
              <label>
                <span>Prescriber PIN</span>
                <input className="input" value={prescription.prescriberPin ?? ''} maxLength={100} onChange={event => onMetadataChange('prescriberPin', event.target.value)} />
              </label>
              <label>
                <span>GMC number <small>(when applicable)</small></span>
                <input className="input" inputMode="numeric" value={prescription.prescriberGmcNumber ?? ''} maxLength={12} onChange={event => onMetadataChange('prescriberGmcNumber', event.target.value.replace(/\D/g, ''))} />
              </label>
              <label>
                <span>GPhC number <small>(when applicable)</small></span>
                <input className="input" value={prescription.prescriberGphcNumber ?? ''} maxLength={100} onChange={event => onMetadataChange('prescriberGphcNumber', event.target.value)} />
              </label>
            </div>
          </section>
        </div>
      ) : null}

      {view !== 'details' ? <section className="manual-rx-medicines">
        <section className="manual-rx-selected">
          <header className="manual-rx-section-heading">
            <span><small>Section 3</small><strong>Selected medicines</strong><em>Set pack quantities for every medicine printed on the prescription.</em></span>
            <span className="manual-rx-section-count">{prescription.items.length} selected</span>
          </header>

          <div className="manual-rx-selected__list">
            {prescription.items.length ? prescription.items.map((item, index) => {
              const product = catalogue.find(candidate => candidate.id === item.productId);
              const packSize = product?.packSize ?? (item.unitsNeededCount && item.qty ? item.unitsNeededCount / item.qty : null);
              const packUnit = product?.unit ?? 'units';
              const patientTotal = item.retail * item.qty;
              const wholesaleTotal = item.cost === null ? null : item.cost * item.qty;
              const contribution = wholesaleTotal === null ? null : patientTotal - wholesaleTotal;
              const margin = wholesaleTotal === null || patientTotal <= 0 ? null : Math.round((contribution! / patientTotal) * 100);
              const unavailable = product?.availability === 'out';
              return (
                <article className="manual-pack-card" key={item.productId}>
                  <header className="manual-pack-card__header">
                    <span className="manual-rx-medicines__number">{index + 1}</span>
                    <span className="manual-rx-medicines__identity">
                      <small>{catalogueTypeLabels[product?.type ?? 'other']} · Curaleaf pack</small>
                      <strong>{item.name}</strong>
                    </span>
                    <span className={`pill ${unavailable ? 'pill-amber' : 'pill-green'}`}>{unavailable ? 'Unavailable after quote' : 'Active'}</span>
                    <button type="button" className="icon-button danger" aria-label={`Remove ${item.name}`} onClick={() => onRemoveItem(item.productId)}><Trash2 size={14} /></button>
                  </header>

                  <div className="manual-pack-card__body">
                    <div className="manual-pack-fact">
                      <span><Package size={15} /><small>API pack size</small></span>
                      <strong>{packSize ?? '—'} {packUnit}</strong>
                      <em>Fixed by Curaleaf</em>
                    </div>

                    <div className="manual-pack-quantity">
                      <small>Packs to order</small>
                      <div className="manual-pack-stepper" aria-label={`Packs of ${item.name}`}>
                        <button type="button" aria-label={`Reduce packs of ${item.name}`} disabled={item.qty <= 1} onClick={() => updatePackQuantity(item, item.qty - 1)}><Minus size={14} /></button>
                        <span><strong>{item.qty}</strong><small>{item.qty === 1 ? 'pack' : 'packs'}</small></span>
                        <button type="button" aria-label={`Add pack of ${item.name}`} disabled={item.qty >= 100} onClick={() => updatePackQuantity(item, item.qty + 1)}><Plus size={14} /></button>
                      </div>
                    </div>

                    <dl className="manual-pack-pricing">
                      <div><dt>Patient / pack</dt><dd>{money(item.retail)}</dd><small>Curaleaf price</small></div>
                      <div className="manual-pack-pricing__total"><dt>Patient total</dt><dd>{money(patientTotal)}</dd><small>{item.qty} × {money(item.retail)}</small></div>
                      <div><dt>Wholesale</dt><dd>{item.cost === null ? 'Quote required' : money(wholesaleTotal!)}</dd><small>{item.cost === null ? 'Returned on quote' : `${money(item.cost)} / pack`}</small></div>
                      <div className={contribution !== null && contribution < 0 ? 'is-negative' : ''}><dt>Gross margin</dt><dd>{contribution === null ? 'Pending' : `${contribution >= 0 ? '+' : '−'}${money(Math.abs(contribution))}`}</dd><small>{margin === null ? 'After quote' : `${margin}% of patient total`}</small></div>
                    </dl>
                  </div>
                </article>
              );
            }) : (
              <div className="manual-rx-selected__empty"><Package size={18} /><span><strong>No medicines selected yet</strong><small>Add every prescribed pack from the live catalogue below.</small></span></div>
            )}
          </div>
        </section>

        <section className="manual-rx-picker">
          <div className="manual-rx-picker__heading">
            <span><small>Section 4</small><strong>Add medicines from the live Curaleaf catalogue</strong><em>Results stay open so you can add several prescribed products quickly.</em></span>
            <small>{filteredProducts.length} matching active pack{filteredProducts.length === 1 ? '' : 's'}</small>
          </div>
          <div className="manual-rx-picker__field">
            <Search size={15} />
            <input
              className="input"
              value={query}
              placeholder="Search medicine, strength or form"
              aria-label="Search the Curaleaf catalogue"
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <div className="manual-rx-picker__filters" role="group" aria-label="Filter catalogue by medicine type">
            <button type="button" aria-pressed={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All <small>{activeProducts.length}</small></button>
            {availableTypes.map(type => (
              <button type="button" key={type} aria-pressed={typeFilter === type} onClick={() => setTypeFilter(type)}>{catalogueTypeLabels[type]} <small>{activeProducts.filter(product => product.type === type).length}</small></button>
            ))}
          </div>
          <div className="manual-rx-picker__results" aria-live="polite">
            {visibleProducts.length ? visibleProducts.map(product => {
              const selected = selectedProductIds.has(product.id);
              return (
                <button type="button" key={product.id} disabled={selected} className={selected ? 'is-selected' : ''} onClick={() => addProduct(product)}>
                  <span className="manual-rx-picker__product"><small>{catalogueTypeLabels[product.type]} · active</small><strong>{product.name}</strong></span>
                  <span className="manual-rx-picker__pack"><small>Pack size</small><strong>{product.packSize ?? '—'} {product.unit ?? 'units'}</strong></span>
                  <span className="manual-rx-picker__price"><small>Patient price</small><strong>{money(product.retail)}</strong></span>
                  <span className="manual-rx-picker__add">{selected ? <Check size={14} /> : <Plus size={14} />} {selected ? 'Added' : 'Add'}</span>
                </button>
              );
            }) : <span className="manual-rx-picker__empty">No active Curaleaf packs match this search and medicine type.</span>}
          </div>
          {filteredProducts.length > visibleProducts.length ? <small className="manual-rx-picker__more">Showing the first {visibleProducts.length} results. Refine the search to find a specific medicine.</small> : null}
        </section>
      </section> : null}
    </div>
  );
}
