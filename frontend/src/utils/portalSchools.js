const WORDS = [
  'school',
  'academy',
  'college',
  'international',
  'high',
  'basic',
  'junior',
  'senior',
  'primary',
  'secondary',
  'community',
  'complex',
  'institute',
  'prep',
  'girls',
  'boys',
  'shs',
  'jhs',
  'montessori',
  'faith',
  'kingdom',
  'royal',
  'star',
  'grace',
  'holy',
  'saint',
];

/** Name fragments that still find schools on an API which ignores a blank search. */
export function portalSchoolProbes() {
  const vowels = 'aeiouy';
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const probes = [...WORDS];
  for (const letter of letters) {
    probes.push(letter + letter);
    for (const vowel of vowels) {
      probes.push(letter + vowel);
      probes.push(vowel + letter);
    }
  }
  return [...new Set(probes)];
}

export function slimPortalSchool(school) {
  if (!school?.id) return null;
  const name = String(school.name || '').trim();
  if (!name) return null;
  const logo = String(school.logo_url || '');
  return {
    ...school,
    name,
    logo_url: !logo || logo.startsWith('data:') || logo.length > 2048 ? null : logo,
  };
}

export function mergePortalSchools(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const school of list || []) {
      const card = slimPortalSchool(school);
      if (card && !byId.has(card.id)) byId.set(card.id, card);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load the school directory. A blank request is enough on the current API.
 * When that comes back empty, ask again with name fragments so an older API
 * that only answers a search still returns the registered schools.
 */
export async function collectPortalSchools(fetchList, options = {}) {
  const probes = options.probes || portalSchoolProbes();
  const concurrency = options.concurrency || 4;
  const onUpdate = options.onUpdate;
  const lists = [];
  const publish = () => {
    const schools = mergePortalSchools(lists);
    if (onUpdate) onUpdate(schools);
    return schools;
  };

  let firstError = null;
  try {
    lists.push(await fetchList());
  } catch (err) {
    firstError = err;
  }
  let schools = publish();
  if (schools.length) return schools;

  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, probes.length || 1) }, async () => {
      while (index < probes.length) {
        const q = probes[index];
        index += 1;
        const folded = String(q || '').toLowerCase();
        if (folded && schools.some((school) => school.name.toLowerCase().includes(folded))) continue;
        try {
          lists.push(await fetchList(q));
          schools = publish();
        } catch (err) {
          firstError = firstError || err;
        }
      }
    })
  );

  if (!schools.length && firstError) throw firstError;
  return schools;
}
