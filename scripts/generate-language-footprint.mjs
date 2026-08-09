import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const username = process.env.GITHUB_USERNAME ?? 'nfonseca-dev';
const token = process.env.GITHUB_TOKEN;
const output = 'assets/practice-evidence.svg';
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

async function getJson(url, { allowNotFound = false } = {}) {
  const response = await fetch(url, { headers });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`);
  return response.json();
}

async function readFile(repository, path) {
  const file = await getJson(`${repository.url}/contents/${path}`, { allowNotFound: true });
  return file?.encoding === 'base64' ? Buffer.from(file.content.replaceAll('\n', ''), 'base64').toString('utf8') : '';
}

async function inspectRepository(repository) {
  const [languages, tree, ...manifests] = await Promise.all([
    getJson(repository.languages_url),
    getJson(`${repository.url}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`),
    ...['package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile'].map((path) => readFile(repository, path)),
  ]);
  const paths = tree.tree.filter(({ type }) => type === 'blob').map(({ path }) => path.toLowerCase());
  const hasPath = (expression) => paths.some((path) => expression.test(path));
  const manifest = manifests.join('\n');
  const python = Object.hasOwn(languages, 'Python');
  const javascript = Object.hasOwn(languages, 'JavaScript');
  const typescript = Object.hasOwn(languages, 'TypeScript') || hasPath(/(^|\/)tsconfig(\..+)?\.json$/);
  const htmlCss = Object.hasOwn(languages, 'HTML') || Object.hasOwn(languages, 'CSS');
  return {
    python, javascript, typescript, htmlCss,
    django: /(?:^|["'\s>=~!])django(?:["'\s<>=~!]|$)/im.test(manifest),
    frontendFramework: /["'](react|next|vue|angular)["']\s*:/im.test(manifest),
    api: hasPath(/(^|\/)(api|views)\//) || /djangorestframework|rest_framework/im.test(manifest),
    database: hasPath(/(^|\/)(models\.py|migrations\/)/),
    authentication: hasPath(/(^|\/)(auth|login|token|jwt|permission)/) || /simplejwt|allauth|oauth|auth0/im.test(manifest),
    tests: hasPath(/(^|\/)(test_.*\.py|.*\.(test|spec)\.[cm]?[jt]sx?|tests?\.py)$/),
    docker: hasPath(/(^|\/)dockerfile$/),
    ci: hasPath(/^\.github\/workflows\/.*\.ya?ml$/),
  };
}

const repositories = await getJson(`https://api.github.com/users/${username}/repos?per_page=100&type=owner`);
const ownedRepositories = repositories.filter((repository) => !repository.fork && !repository.archived);
const projects = await Promise.all(ownedRepositories.map(inspectRepository));
const count = (predicate) => projects.filter(predicate).length;

// Topics and weights are adapted from roadmap.sh's Backend and Full Stack roadmaps.
const tracks = [
  {
    name: 'BACKEND', color: '#44b78b',
    topics: [
      ['Python & Django', 15, ({ python, django }) => python && django, 'Python source + Django dependency'],
      ['REST APIs', 15, ({ api }) => api, 'API/views path or Django REST Framework'],
      ['Databases & ORM', 15, ({ database }) => database, 'models.py or migrations directory'],
      ['Authentication', 15, ({ authentication }) => authentication, 'auth/token path or auth dependency'],
      ['Automated testing', 15, ({ tests }) => tests, 'test or spec files'],
      ['Docker', 10, ({ docker }) => docker, 'Dockerfile'],
      ['CI/CD', 15, ({ ci }) => ci, '.github/workflows'],
    ],
  },
  {
    name: 'FRONTEND', color: '#58a6ff',
    topics: [
      ['HTML & CSS', 15, ({ htmlCss }) => htmlCss, 'HTML or CSS source files'],
      ['JavaScript', 15, ({ javascript }) => javascript, 'JavaScript source files'],
      ['TypeScript', 15, ({ typescript }) => typescript, 'TypeScript source or tsconfig'],
      ['UI framework', 20, ({ frontendFramework }) => frontendFramework, 'React, Next, Vue or Angular dependency'],
      ['Automated testing', 15, ({ tests, javascript, typescript }) => tests && (javascript || typescript), 'test/spec files in frontend project'],
      ['Docker / CI', 20, ({ docker, ci }) => docker || ci, 'Dockerfile or GitHub Actions workflow'],
    ],
  },
  {
    name: 'FULL-STACK', color: '#a371f7',
    topics: [
      ['Client + server', 25, ({ python, javascript, typescript, htmlCss }) => python && (javascript || typescript || htmlCss), 'frontend + backend code in one project'],
      ['API + data layer', 25, ({ api, database }) => api && database, 'API evidence + models/migrations'],
      ['Authentication flow', 15, ({ authentication }) => authentication, 'auth/token path or auth dependency'],
      ['Quality checks', 15, ({ tests }) => tests, 'test or spec files'],
      ['Delivery workflow', 20, ({ docker, ci }) => docker || ci, 'Dockerfile or GitHub Actions workflow'],
    ],
  },
].map((track) => ({
  ...track,
  topics: track.topics.map(([name, points, applies, reason]) => {
    const projectsCount = count(applies);
    return { name, points, reason, projectsCount, applied: projectsCount > 0 };
  }),
}));

for (const track of tracks) track.score = track.topics.reduce((total, topic) => total + (topic.applied ? topic.points : 0), 0);

const generatedAt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
const positions = [35, 335, 635];
const cards = tracks.map((track, index) => {
  const x = positions[index];
  const rows = track.topics.map((topic, topicIndex) => {
    const y = 201 + topicIndex * 58;
    const status = topic.applied ? `✓ ${topic.projectsCount} ${topic.projectsCount === 1 ? 'project' : 'projects'}` : '○ not detected';
    return `<circle cx="${x + 19}" cy="${y - 5}" r="4" fill="${topic.applied ? track.color : '#484f58'}">${topic.applied ? `<animate attributeName="opacity" values=".45;1;.45" dur="2s" begin="${topicIndex * 0.15}s" repeatCount="indefinite"/>` : ''}</circle><text x="${x + 30}" y="${y}" fill="${topic.applied ? '#c9d1d9' : '#8b949e'}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12">${topic.name.replace('&', '&amp;')}</text><text x="${x + 30}" y="${y + 16}" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="10">${status}</text><text x="${x + 30}" y="${y + 30}" fill="#6e7681" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="9">${topic.reason.replace('&', '&amp;')}</text><text x="${x + 264}" y="${y + 9}" fill="${topic.applied ? track.color : '#484f58'}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12" font-weight="700" text-anchor="end">${topic.applied ? `+${topic.points}` : '0'}/${topic.points}</text>`;
  }).join('');
  return `<g><rect x="${x}" y="148" width="290" height="460" rx="12" fill="#161b22" stroke="#30363d"/><text x="${x + 16}" y="178" fill="${track.color}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="16" font-weight="700">${track.name}</text><text x="${x + 273}" y="178" fill="#f0f6fc" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="18" font-weight="700" text-anchor="end">${track.score}/100</text><path d="M${x + 16} 187h258" stroke="#30363d"/>${rows}</g>`;
}).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="700" viewBox="0 0 960 700" role="img" aria-labelledby="title desc">
  <title id="title">Backend, frontend and full-stack roadmap practice</title><desc id="desc">A roadmap.sh-inspired breakdown of skills with points awarded when evidence is found in public projects.</desc>
  <defs><linearGradient id="background" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0d1117"/><stop offset="1" stop-color="#161b22"/></linearGradient></defs>
  <rect width="960" height="700" rx="16" fill="url(#background)"/><rect x=".5" y=".5" width="959" height="699" rx="15.5" fill="none" stroke="#30363d"/>
  <circle cx="34" cy="33" r="7" fill="#ff5f56"/><circle cx="58" cy="33" r="7" fill="#ffbd2e"/><circle cx="82" cy="33" r="7" fill="#27c93f"/><text x="480" y="39" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" text-anchor="middle">~/github · roadmap practice ledger</text><path d="M0 66h960" stroke="#30363d"/>
  <text x="35" y="108" fill="#f0f6fc" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="22" font-weight="700">Practice evidence by roadmap track</text><text x="35" y="130" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12">every point requires public-project evidence · criteria listed below</text>
  ${cards}
  <text x="35" y="658" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11">inspired by roadmap.sh · each row lists the exact evidence used for its points</text><text x="925" y="658" fill="#484f58" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11" text-anchor="end">updated ${generatedAt}</text>
</svg>`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, svg);
console.log(`Generated ${output} from ${ownedRepositories.length} repositories.`);
