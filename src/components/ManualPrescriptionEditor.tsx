import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, Trash2 } from 'lucide-react';
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

  return (
    <div className="manual-rx-editor">
      {view !== 'formulary' ? (
        <>
          <div className="manual-rx-editor__notice">
            <AlertTriangle size={17} />
            <span>
              <strong>Manual prescription entry</strong>
              <small>Copy every field from the signed prescription. HHH will check the serial with Curaleaf before creating a supplier record.</small>
            </span>
          </div>

          <div className="manual-rx-fields">
            <label>
              <span>Patient’s full name</span>
              <input className="input" value={prescription.curaleafPatientName ?? ''} maxLength={200} onChange={event => onPatientIdentityChange(event.target.value, prescription.curaleafPatientDob ?? '')} />
            </label>
            <label>
              <span>Patient’s date of birth</span>
              <input className="input" type="date" value={prescription.curaleafPatientDob ?? ''} onChange={event => onPatientIdentityChange(prescription.curaleafPatientName ?? '', event.target.value)} />
            </label>
            <label>
              <span>Prescription serial</span>
              <input className="input" value={prescription.serialNumber ?? ''} maxLength={200} onChange={event => onMetadataChange('serialNumber', event.target.value)} />
            </label>
            <label>
              <span>Issue date</span>
              <input className="input" type="date" value={prescription.issueDate ?? ''} onChange={event => onMetadataChange('issueDate', event.target.value)} />
            </label>
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
        </>
      ) : null}

      {view !== 'details' ? <section className="manual-rx-medicines">
        <header>
          <span><small>Curaleaf formulary</small><strong>{prescription.items.length} prescribed medicine{prescription.items.length === 1 ? '' : 's'} selected</strong></span>
        </header>

        {prescription.items.map((item, index) => (
          <article key={item.productId}>
            <span className="manual-rx-medicines__number">{index + 1}</span>
            <span className="manual-rx-medicines__identity"><strong>{item.name}</strong><small>{money(item.retail)} patient pack price · Curaleaf-managed</small></span>
            <label><span>Prescribed units</span><input className="input" type="number" min="1" max="100" value={item.unitsNeededCount ?? 1} onChange={event => onUpdateUnits(item.productId, Number(event.target.value))} /></label>
            <label><span>Packs</span><input className="input" type="number" min="1" max="100" value={item.qty} onChange={event => onUpdateQuantity(item.productId, Number(event.target.value))} /></label>
            <button type="button" className="icon-button danger" aria-label={`Remove ${item.name}`} onClick={() => onRemoveItem(item.productId)}><Trash2 size={14} /></button>
          </article>
        ))}

        <div className="manual-rx-picker">
          <div className="manual-rx-picker__field">
            <Search size={15} />
            <input
              className="input"
              value={query}
              placeholder="Search the Curaleaf catalogue"
              onFocus={() => setPickerOpen(true)}
              onChange={event => { setQuery(event.target.value); setPickerOpen(true); }}
            />
          </div>
          {pickerOpen && (
            <div className="manual-rx-picker__results">
              {products.length ? products.map(product => (
                <button type="button" key={product.id} onClick={() => addProduct(product)}>
                  <span><strong>{product.name}</strong><small>{product.packSize ?? '—'} {product.unit ?? 'units'} · {money(product.retail)}</small></span>
                  <Plus size={14} />
                </button>
              )) : <span>No additional active Curaleaf products match.</span>}
            </div>
          )}
        </div>
      </section> : null}
    </div>
  );
}
