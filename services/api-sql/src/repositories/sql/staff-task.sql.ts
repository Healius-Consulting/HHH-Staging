import { dataConnect } from '../../bootstrap/firebase.js';

const INSERT_STAFF_TASK_GQL = `
  mutation InsertStaffTask(
    $id: UUID!
    $organisationId: UUID
    $taskType: String!
    $priority: Int!
    $title: String!
    $details: Any
    $dueAt: Timestamp
  ) {
    staffTask_insert(data: {
      id: $id
      organisationId: $organisationId
      taskType: $taskType
      status: OPEN
      priority: $priority
      title: $title
      details: $details
      dueAt: $dueAt
      version: 1
    })
  }
`;

export async function insertStaffTask(input: {
  id: string;
  organisationId: string;
  taskType: string;
  priority: number;
  title: string;
  details?: unknown;
  dueAt?: string | null;
}) {
  try {
    await dataConnect.executeGraphql(INSERT_STAFF_TASK_GQL, {
      variables: {
        id: input.id,
        organisationId: input.organisationId,
        taskType: input.taskType,
        priority: input.priority,
        title: input.title,
        details: input.details ?? null,
        dueAt: input.dueAt ?? null,
      },
    });
  } catch {
    // Duplicate deterministic ids are treated as already raised.
  }
}
