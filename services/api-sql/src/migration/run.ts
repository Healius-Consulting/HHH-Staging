import { runBackfill } from './backfill.js';
import { reconcileDataParity } from './reconcile.js';

async function main() {
  console.log('==================================================');
  console.log('HHH Platform: Starting Migration & Reconciliation');
  console.log('==================================================\n');

  try {
    const stats = await runBackfill();
    console.log('\n[Backfill Results]:', JSON.stringify(stats, null, 2));

    console.log('\nStarting Cryptographic Parity Reconciliation...');
    const report = await reconcileDataParity();
    console.log('\n[Reconciliation Report]:', JSON.stringify(report, null, 2));

    console.log('\n==================================================');
    console.log(`STATUS: Complete. Data Parity: ${report.parityRatePercent}%`);
    console.log('==================================================');
  } catch (error) {
    console.error('Migration execution error:', error);
    process.exit(1);
  }
}

void main();
