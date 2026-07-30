import { useMemo, useState } from 'react';
import { FileText, Minus, Package, Plus, Search, Stethoscope, Trash2, UserRound } from 'lucide-react';
import type { CatalogueItem, LineItem, Prescription } from '../context/AppContext';
import { money } from '../context/AppContext';
import './ManualPrescriptionEditor.css';

type MetadataField = 'serialNumber' | 'issueDate' | 'prescriberPin' | 'prescriberGmcNumber' | 'prescriberGphcNumber';
export type ManualPrescriptionEditorView = 'details' | 'formulary' | 'all';

export default function ManualPrescriptionEditor({
  prescription,
  catalogue,
  view = 'all',
  onPrescriberChange,
  onPatientIdentityChange,
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
  onPatientIdentityChange: (name: string, dob: string) => void;
  onMetadataChange: (field: MetadataField, value: string) => void;
  onAddItem: (item: LineItem) => void;
  onRemoveItem: (productId: string) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onUpdateUnits: (productId: string, units: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const products = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('en-GB');
    const selected = new Set(prescription.items.map(item => item.productId));
    return catalogue
      .filter(product => product.supplierState === 'ACTIVE' && product.formulaId && !selected.has(product.id))
      .filter(product => !needle || `${product.name} ${product.unit ?? ''}`.toLocaleLowerCase('en-GB').includes(needle))
      .slice(0, 8);
  }, [catalogue, prescription.items, query]);

  const addProduct = (product: CatalogueItem) => {
    onAddItem({
      productId: product.id,
      formulaId: product.formulaId,
      name: product.name,
      qty: 1,
      unitsNeededCount: product.packSize ?? 1,
      cost: null,
      retail: product.retail,
    });
    setQuery('');
    setPickerOpen(false);
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
            <span><small>Prescription details</small><strong>Copy the signed document exactly</strong></span>
            <small>Required fields are checked before payment.</small>
          </header>

          <section className="manual-rx-field-group">
            <header><UserRound size={15} /><span><small>01</small><strong>Patient on prescription</strong></span></header>
            <div className="manual-rx-fields">
              <label>
                <span>Patient’s full name</span>
                <input className="input" value={prescription.curaleafPatientName ?? ''} maxLength={200} onChange={event => onPatientIdentityChange(event.target.value, prescription.curaleafPatientDob ?? '')} />
              </label>
              <label>
                <span>Date of birth</span>
                <input className="input" type="date" value={prescription.curaleafPatientDob ?? ''} onChange={event => onPatientIdentityChange(prescription.curaleafPatientName ?? '', event.target.value)} />
              </label>
            </div>
          </section>

          <section className="manual-rx-field-group">
            <header><FileText size={15} /><span><small>02</small><strong>Prescription record</strong></span></header>
            <div className="manual-rx-fields">
              <label>
                <span>Prescription serial</span>
                <input className="input" value={prescription.serialNumber ?? ''} maxLength={200} onChange={event => onMetadataChange('serialNumber', event.target.value)} />
              </label>
              <label>
                <span>Issue date</span>
                <input className="input" type="date" value={prescription.issueDate ?? ''} onChange={event => onMetadataChange('issueDate', event.target.value)} />
              </label>
            </div>
          </section>

          <section className="manual-rx-field-group">
            <header><Stethoscope size={15} /><span><small>03</small><strong>Prescriber</strong></span></header>
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
        <header>
          <span><small>Curaleaf formulary</small><strong>{prescription.items.length} prescribed medicine{prescription.items.length === 1 ? '' : 's'} selected</strong></span>
        </header>

        {prescription.items.map((item, index) => {
          const product = catalogue.find(candidate => candidate.id === item.productId);
          const packSize = product?.packSize ?? (item.unitsNeededCount && item.qty ? item.unitsNeededCount / item.qty : null);
          const packUnit = product?.unit ?? 'units';
          const patientTotal = item.retail * item.qty;
          const wholesaleTotal = item.cost === null ? null : item.cost * item.qty;
          const contribution = wholesaleTotal === null ? null : patientTotal - wholesaleTotal;
          const margin = wholesaleTotal === null || patientTotal <= 0 ? null : Math.round((contribution! / patientTotal) * 100);
          return (
            <article className="manual-pack-card" key={item.productId}>
              <header className="manual-pack-card__header">
                <span className="manual-rx-medicines__number">{index + 1}</span>
                <span className="manual-rx-medicines__identity">
                  <small>Curaleaf formulary pack</small>
                  <strong>{item.name}</strong>
                </span>
                <span className="pill pill-green">Active</span>
                <button type="button" className="icon-button danger" aria-label={`Remove ${item.name}`} onClick={() => onRemoveItem(item.productId)}><Trash2 size={14} /></button>
              </header>

              <div className="manual-pack-card__body">
                <div className="manual-pack-fact">
                  <span><Package size={15} /><small>Pack supplied by Curaleaf</small></span>
                  <strong>{packSize ?? '—'} {packUnit}</strong>
                  <em>Pack size is fixed from the API</em>
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
                  <div><dt>Patient pack price</dt><dd>{money(item.retail)}</dd><small>Set by Curaleaf</small></div>
                  <div className="manual-pack-pricing__total"><dt>Patient line total</dt><dd>{money(patientTotal)}</dd><small>{item.qty} × {money(item.retail)}</small></div>
                  <div><dt>Wholesale</dt><dd>{item.cost === null ? 'Quote required' : money(wholesaleTotal!)}</dd><small>{item.cost === null ? 'Returned for this order' : `${money(item.cost)} per pack`}</small></div>
                  <div className={contribution !== null && contribution < 0 ? 'is-negative' : ''}><dt>Gross margin</dt><dd>{contribution === null ? 'Pending' : `${contribution >= 0 ? '+' : '−'}${money(Math.abs(contribution))}`}</dd><small>{margin === null ? 'Available after quote' : `${margin}% of patient total`}</small></div>
                </dl>
              </div>
            </article>
          );
        })}

        <div className="manual-rx-picker">
          <div className="manual-rx-picker__heading">
            <span><small>Add formulary pack</small><strong>Search the live Curaleaf catalogue</strong></span>
            <small>Pack size and patient price come directly from Curaleaf.</small>
          </div>
          <div className="manual-rx-picker__field">
            <Search size={15} />
            <input
              className="input"
              value={query}
              placeholder="Search the Curaleaf catalogue"
              onFocus={() => setPickerOpen(true)}
              onChange={event => { setQuery(event.target.value); setPickerOpen(true); }}
              onKeyDown={event => { if (event.key === 'Escape') setPickerOpen(false); }}
            />
          </div>
          {pickerOpen && (
            <div className="manual-rx-picker__results">
              {products.length ? products.map(product => (
                <button type="button" key={product.id} onClick={() => addProduct(product)}>
                  <span className="manual-rx-picker__product"><small>{product.type} · active</small><strong>{product.name}</strong></span>
                  <span className="manual-rx-picker__pack"><small>Pack size</small><strong>{product.packSize ?? '—'} {product.unit ?? 'units'}</strong></span>
                  <span className="manual-rx-picker__price"><small>Patient price</small><strong>{money(product.retail)}</strong></span>
                  <span className="manual-rx-picker__add"><Plus size={14} /> Add</span>
                </button>
              )) : <span className="manual-rx-picker__empty">No additional active Curaleaf packs match this search.</span>}
            </div>
          )}
        </div>
      </section> : null}
    </div>
  );
}
