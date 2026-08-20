import assert from 'node:assert/strict';
import test from 'node:test';
import { splitMedicineLabel } from '../src/utils/medicineLabel.ts';

test('splits flower names after the last comma before THC/CBD percentages', () => {
  assert.deepEqual(
    splitMedicineLabel('4C Labs BWD T30 Beach Wedding, 30% THC <1% CBD'),
    { title: '4C Labs BWD T30 Beach Wedding', strength: '30% THC <1% CBD' },
  );
  assert.deepEqual(
    splitMedicineLabel('Bedrolite, <1% THC 9% CBD'),
    { title: 'Bedrolite', strength: '<1% THC 9% CBD' },
  );
  assert.deepEqual(
    splitMedicineLabel('Khiron 1:1, 10% THC 10% CBD'),
    { title: 'Khiron 1:1', strength: '10% THC 10% CBD' },
  );
});

test('splits oil and capsule names on mg or mg/ml concentration', () => {
  assert.deepEqual(
    splitMedicineLabel('Adven EMT 20:1 CBM Oil, 20mg/ml THC : 1mg/ml CBD'),
    { title: 'Adven EMT 20:1 CBM Oil', strength: '20mg/ml THC : 1mg/ml CBD' },
  );
  assert.deepEqual(
    splitMedicineLabel('Spectrum Blue Oil, 10mg/ml CBD'),
    { title: 'Spectrum Blue Oil', strength: '10mg/ml CBD' },
  );
  assert.deepEqual(
    splitMedicineLabel('Tilray Oral Solution THC25:CBD50, 25mg/ml THC : 50mg/ml CBD'),
    { title: 'Tilray Oral Solution THC25:CBD50', strength: '25mg/ml THC : 50mg/ml CBD' },
  );
  assert.deepEqual(
    splitMedicineLabel('Adven EMT Capsules, 10mg THC'),
    { title: 'Adven EMT Capsules', strength: '10mg THC' },
  );
});

test('splits vape cartridge size in grams and leaves pack count out of the name', () => {
  assert.deepEqual(
    splitMedicineLabel('Curaleaf Hybrid Cartridge, 1g'),
    { title: 'Curaleaf Hybrid Cartridge', strength: '1g' },
  );
  assert.deepEqual(
    splitMedicineLabel('Curaleaf Hybrid Cartridge, 0.5g'),
    { title: 'Curaleaf Hybrid Cartridge', strength: '0.5g' },
  );
  assert.deepEqual(
    splitMedicineLabel('Curaleaf Hybrid Cartridge 1g'),
    { title: 'Curaleaf Hybrid Cartridge', strength: '1g' },
  );
});

test('splits a trailing strength when the catalogue omits the comma', () => {
  assert.deepEqual(
    splitMedicineLabel('Aurora Pink Kush 20% THC <1% CBD'),
    { title: 'Aurora Pink Kush', strength: '20% THC <1% CBD' },
  );
  assert.deepEqual(
    splitMedicineLabel('Noidecs T10:C10 Oil 10mg/ml THC 10mg/ml CBD'),
    { title: 'Noidecs T10:C10 Oil', strength: '10mg/ml THC 10mg/ml CBD' },
  );
});

test('keeps strain codes and unsuffixed names on one line', () => {
  assert.deepEqual(
    splitMedicineLabel('4C Labs BWD T30 Beach Wedding'),
    { title: '4C Labs BWD T30 Beach Wedding', strength: null },
  );
  assert.deepEqual(
    splitMedicineLabel('Synthetic Curaleaf Clinic training medicine'),
    { title: 'Synthetic Curaleaf Clinic training medicine', strength: null },
  );
});

test('splits parenthetical strengths and cannabinoid-first mg labels', () => {
  assert.deepEqual(
    splitMedicineLabel('Aurora Equilibre (10% THC 10% CBD)'),
    { title: 'Aurora Equilibre', strength: '10% THC 10% CBD' },
  );
  assert.deepEqual(
    splitMedicineLabel('Tilray Oral Solution, THC 25mg/ml : CBD 50mg/ml'),
    { title: 'Tilray Oral Solution', strength: 'THC 25mg/ml : CBD 50mg/ml' },
  );
});
