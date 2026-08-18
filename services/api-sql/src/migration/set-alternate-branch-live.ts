import { SqlOrganisationRepository } from '../repositories/sql/organisation.sql.js';

const ALTERNATE_BRANCH_ID = 'f486a221-2236-44a5-b072-f06de399ab0e';

async function main() {
  const organisationRepo = new SqlOrganisationRepository();
  const organisation = await organisationRepo.findOrganisationById(ALTERNATE_BRANCH_ID);
  if (!organisation) {
    throw new Error('Alternate Branch was not found.');
  }

  const setupTasks = await organisationRepo.listSetupTasks(ALTERNATE_BRANCH_ID);
  const before = {
    id: organisation.id,
    tradingName: organisation.tradingName,
    status: organisation.status,
    classification: organisation.classification,
    setup: setupTasks.map(task => ({ taskCode: task.taskCode, required: task.required, completed: task.completed })),
  };
  console.log(JSON.stringify({ before }, null, 2));

  if (organisation.classification !== 'STANDARD') {
    await organisationRepo.updateOrganisationClassification(ALTERNATE_BRANCH_ID, 'STANDARD');
  }

  const updated = await organisationRepo.findOrganisationById(ALTERNATE_BRANCH_ID);
  console.log(JSON.stringify({
    after: {
      id: updated?.id,
      tradingName: updated?.tradingName,
      status: updated?.status,
      classification: updated?.classification,
    },
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
