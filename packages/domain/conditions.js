export const CONDITIONS = Object.freeze([
  ['adhd', 'ADHD (Attention Deficit Hyperactivity Disorder)'],
  ['agoraphobia', 'Agoraphobia'],
  ['anxiety', 'Anxiety'],
  ['arthritis', 'Arthritis'],
  ['autistic-spectrum-disorder', 'Autistic Spectrum Disorder'],
  ['breast-pain', 'Breast Pain'],
  ['cancer-related-appetite-loss', 'Cancer Related Appetite Loss'],
  ['cancer-related-pain-and-secondary-symptoms', 'Cancer Related Pain and Other Secondary Symptoms'],
  ['chemotherapy-induced-nausea-and-vomiting', 'Chemotherapy Induced Nausea and Vomiting'],
  ['chronic-fatigue-syndrome-me', 'Chronic Fatigue Syndrome (ME)'],
  ['chronic-pain', 'Chronic Pain'],
  ['cluster-headache', 'Cluster Headache'],
  ['complex-regional-pain-syndrome', 'Complex Regional Pain Syndrome'],
  ['crohns-disease', "Crohn's Disease"],
  ['depression', 'Depression'],
  ['ehlers-danlos-syndrome', 'Ehlers-Danlos Syndrome'],
  ['endometriosis', 'Endometriosis'],
  ['epilepsy', 'Epilepsy (Adult & Child)'],
  ['fibromyalgia', 'Fibromyalgia'],
  ['insomnia', 'Insomnia'],
  ['low-back-pain-and-sciatica', 'Low Back Pain and Sciatica'],
  ['migraine', 'Migraine'],
  ['multiple-sclerosis', 'Multiple Sclerosis (MS)'],
  ['musculoskeletal-pain', 'Musculoskeletal Pain'],
  ['neuropathic-pain', 'Neuropathic Pain'],
  ['obsessive-compulsive-disorder', 'Obsessive Compulsive Disorder (OCD)'],
  ['other-gastrointestinal-condition', 'Other Gastrointestinal Condition'],
  ['other-neurological-disorder', 'Other Neurological Disorder'],
  ['palliative-care', 'Palliative Care'],
  ['parkinsons-disease', "Parkinson's Disease"],
  ['post-traumatic-stress-disorder', 'Post Traumatic Stress Disorder (PTSD)'],
  ['rare-or-challenging-skin-condition', 'Rare or Challenging Skin Condition'],
  ['social-phobia', 'Social Phobia'],
  ['tourettes-syndrome', "Tourette's Syndrome"],
  ['trigeminal-neuralgia', 'Trigeminal Neuralgia'],
  ['ulcerative-colitis', 'Ulcerative Colitis'],
].map(([id, label]) => Object.freeze({ id, label })));

export const CONDITION_IDS = Object.freeze(CONDITIONS.map(condition => condition.id));

const LEGACY_ALIASES = new Map([
  ['ADHD', 'adhd'],
  ['Autism Spectrum Disorder', 'autistic-spectrum-disorder'],
  ['Cancer-related Appetite Loss', 'cancer-related-appetite-loss'],
  ['Cancer-related Pain', 'cancer-related-pain-and-secondary-symptoms'],
  ['Chemotherapy-induced Nausea & Vomiting', 'chemotherapy-induced-nausea-and-vomiting'],
  ['Crohn’s Disease', 'crohns-disease'],
  ['Ehlers-Danlos Syndromes (EDS)', 'ehlers-danlos-syndrome'],
  ['Epilepsy', 'epilepsy'],
  ['Multiple Sclerosis', 'multiple-sclerosis'],
  ['Obsessive-Compulsive Disorder (OCD)', 'obsessive-compulsive-disorder'],
  ['Parkinson’s Disease', 'parkinsons-disease'],
  ['Post-Traumatic Stress Disorder (PTSD)', 'post-traumatic-stress-disorder'],
  ['PTSD', 'post-traumatic-stress-disorder'],
  ['Tourette’s Syndrome', 'tourettes-syndrome'],
]);

const BY_ID = new Map(CONDITIONS.map(condition => [condition.id, condition]));
const BY_LABEL = new Map(CONDITIONS.map(condition => [condition.label, condition.id]));

export function isConditionId(value) {
  return typeof value === 'string' && BY_ID.has(value);
}

export function conditionLabel(value) {
  return BY_ID.get(value)?.label ?? String(value ?? 'Unknown condition');
}

export function normaliseConditionId(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (BY_ID.has(candidate)) return candidate;
  return BY_LABEL.get(candidate) ?? LEGACY_ALIASES.get(candidate) ?? null;
}
