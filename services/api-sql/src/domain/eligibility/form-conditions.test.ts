import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formConditionRecords, primaryConditionCode } from './form-conditions.js';

describe('eligibility form conditions', () => {
  it('stores selected conditions on the form and marks the primary', () => {
    const records = formConditionRecords({
      conditionCodes: ['chronic-pain', 'anxiety', 'chronic-pain'],
      primaryConditionCode: 'anxiety',
    });
    assert.deepEqual(records, [
      { conditionCode: 'chronic-pain', primary: false },
      { conditionCode: 'anxiety', primary: true },
    ]);
    assert.equal(primaryConditionCode(records), 'anxiety');
  });

  it('falls back to joined condition rows when the form fields are empty', () => {
    const records = formConditionRecords({
      conditions: [
        { conditionCode: 'insomnia', primary: true },
        { conditionCode: 'migraine', primary: false },
      ],
    });
    assert.deepEqual(records.map((record) => record.conditionCode), ['insomnia', 'migraine']);
    assert.equal(primaryConditionCode(records), 'insomnia');
  });
});
