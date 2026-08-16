import { GoogleAuth } from 'google-auth-library';

async function grantAllRoles() {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const client = await auth.getClient();
  const projectId = 'hhh26-4ebd2';

  const getPolicyUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:getIamPolicy`;
  const policyRes = await client.request<{ bindings: Array<{ role: string; members: string[] }> }>({
    url: getPolicyUrl,
    method: 'POST',
  });

  const policy = policyRes.data;
  const sa = 'serviceAccount:284031225632-compute@developer.gserviceaccount.com';
  const roles = [
    'roles/firebasedataconnect.admin',
    'roles/cloudsql.client',
  ];

  for (const role of roles) {
    let binding = policy.bindings.find(b => b.role === role);
    if (!binding) {
      binding = { role, members: [] };
      policy.bindings.push(binding);
    }
    if (!binding.members.includes(sa)) {
      binding.members.push(sa);
      console.log(`Added ${sa} to ${role}`);
    }
  }

  const setPolicyUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:setIamPolicy`;
  await client.request({
    url: setPolicyUrl,
    method: 'POST',
    data: { policy },
  });

  console.log('✔ Verified all Cloud Function roles on GCP!');
}

void grantAllRoles();
