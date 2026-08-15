import assert from 'node:assert/strict';
import test from 'node:test';
import { surfaceRelativePath, surfaceRoutePath } from '../src/routing/surfaceRoute.ts';

test('combined portal routes retain their protected surface prefix', () => {
  assert.equal(surfaceRoutePath('/', '/pharmacy'), '/pharmacy');
  assert.equal(surfaceRoutePath('/orders', '/pharmacy'), '/pharmacy/orders');
  assert.equal(surfaceRelativePath('/pharmacy/orders', '/pharmacy'), '/orders');
  assert.equal(surfaceRelativePath('/admin/orders', '/pharmacy'), null);
});

test('admin routes retain their portal namespace', () => {
  assert.equal(surfaceRoutePath('/', '/admin'), '/admin');
  assert.equal(surfaceRoutePath('/finance', '/admin'), '/admin/finance');
  assert.equal(surfaceRelativePath('/admin/finance', '/admin'), '/finance');
  assert.equal(surfaceRelativePath('/pharmacy/finance', '/admin'), null);
});
