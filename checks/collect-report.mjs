import { execFileSync } from 'node:child_process';

function ghJSON(args) {
  const output = execFileSync('gh', ['api', ...args], { encoding: 'utf8' });
  return JSON.parse(output);
}

export async function pipelineOf(repo, sha) {
  const runs = ghJSON([
    `repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`,
  ]);
  const run = Array.isArray(runs.workflow_runs) ? runs.workflow_runs[0] : undefined;
  if (!run) throw new Error(`Kein CI-Lauf für ${sha} gefunden`);

  const jobList = ghJSON([`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`]);
  const jobs = {};
  let latest = 0;
  for (const job of jobList.jobs ?? []) {
    if (job.status !== 'completed' || !job.started_at || !job.completed_at) continue;
    const seconds = Math.round((Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000);
    jobs[job.name] = seconds;
    const completed = Date.parse(job.completed_at);
    if (completed > latest) latest = completed;
  }
  const started = Date.parse(run.run_started_at ?? '');
  const totalS = Number.isNaN(started) || latest === 0 ? 0 : Math.round((latest - started) / 1000);
  return {
    runId: run.id,
    url: run.html_url,
    jobs,
    totalS,
  };
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

async function ghcrToken(name) {
  const scope = encodeURIComponent(`repository:${name}:pull`);
  const response = await fetch(`https://ghcr.io/token?scope=${scope}`);
  if (!response.ok) throw new Error(`GHCR-Token für ${name}: ${response.status}`);
  const body = await response.json();
  if (!body || typeof body.token !== 'string' || body.token.length === 0) {
    throw new Error(`GHCR-Token für ${name} fehlt`);
  }
  return body.token;
}

async function fetchManifest(name, reference, token) {
  const response = await fetch(`https://ghcr.io/v2/${name}/manifests/${reference}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: MANIFEST_ACCEPT,
    },
  });
  if (!response.ok) {
    throw new Error(`Manifest ${name}:${reference}: ${response.status}`);
  }
  const body = await response.json();
  return { body, contentType: response.headers.get('content-type') ?? '' };
}

export async function imageSizeMB(name, tag) {
  const token = await ghcrToken(name);
  let manifest = await fetchManifest(name, tag, token);
  const isIndex =
    manifest.contentType.includes('image.index') ||
    manifest.contentType.includes('manifest.list') ||
    Array.isArray(manifest.body.manifests);
  if (isIndex) {
    const entries = Array.isArray(manifest.body.manifests) ? manifest.body.manifests : [];
    const target =
      entries.find((entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === 'amd64') ??
      entries[0];
    if (!target?.digest) throw new Error(`Kein amd64-Manifest für ${name}:${tag}`);
    manifest = await fetchManifest(name, target.digest, token);
  }
  const layers = Array.isArray(manifest.body.layers) ? manifest.body.layers : [];
  const total = layers.reduce((sum, layer) => sum + (typeof layer.size === 'number' ? layer.size : 0), 0);
  return Math.round((total / (1024 * 1024)) * 10) / 10;
}
