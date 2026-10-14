import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/publish.yml', import.meta.url)),
  'utf8',
);

/** Top-level jobs of the workflow, keyed by id, each as its raw text. */
function jobsOf(text: string): Map<string, string> {
  const start = text.indexOf('\njobs:\n');
  const jobs = new Map<string, string>();
  const heads = [...text.slice(start).matchAll(/^ {2}([\w-]+):\s*$/gm)];
  heads.forEach((head, i) => {
    const from = start + (head.index ?? 0);
    const next = heads[i + 1];
    const to = next === undefined ? text.length : start + (next.index ?? 0);
    jobs.set(head[1] ?? '', text.slice(from, to));
  });
  return jobs;
}

/** The ids a job lists under `needs:`, as a scalar or a flow list. */
function needsOf(job: string): string[] {
  const match = job.match(/^ {4}needs:\s*\[?([^\]\n]*)\]?\s*$/m);
  return match ? (match[1] ?? '').split(',').map((id) => id.trim()) : [];
}

const jobs = jobsOf(workflow);
const publishJobs = ['publish-npm', 'publish-pypi'];
// What builds the artifact each publish job publishes.
const builders: Record<string, string[]> = {
  'publish-npm': ['build-wasm'],
  'publish-pypi': ['build-wheels'],
};

describe('publish workflow privilege and state transitions', () => {
  it('builds read-only and publishes the exact uploaded artifact', () => {
    for (const id of ['verify', 'build-wasm', 'build-wheels', 'build-cli']) {
      const job = jobs.get(id) ?? '';
      expect(job, id).toContain('contents: read');
      expect(job, id).not.toContain('id-token: write');
      expect(job, id).not.toContain('contents: write');
      expect(job, id).toContain('actions/upload-artifact@v7');
    }
    expect(jobs.get('verify')).toContain('npm pack --ignore-scripts');
    expect(jobs.get('verify')).toContain('make release-check');
    // release-check runs before anything is packed.
    const verify = jobs.get('verify') ?? '';
    expect(verify.indexOf('make release-check')).toBeLessThan(verify.indexOf('npm pack'));
    // Every publish job waits for verify and its builder, and publishes what they uploaded.
    for (const id of publishJobs) {
      const job = jobs.get(id) ?? '';
      expect(job, id).not.toBe('');
      const needs = needsOf(job);
      expect(needs, id).toContain('verify');
      for (const builder of builders[id] ?? []) expect(needs, id).toContain(builder);
      expect(job, id).toContain('actions/download-artifact@v8');
      expect(job, id).not.toContain('actions/checkout');
      expect(job, id).not.toContain('yarn install');
    }
  });

  it('makes retries idempotent and creates the release only after npm publication', () => {
    const npm = jobs.get('publish-npm') ?? '';
    const view = npm.indexOf('npm view "$name@$version"');
    const npmPublish = npm.indexOf('npm publish "$tarball"');
    expect(view).toBeGreaterThan(0);
    expect(npmPublish).toBeGreaterThan(view);
    expect(jobs.get('publish-pypi')).toContain('skip-existing: true');

    const release = jobs.get('release') ?? '';
    expect(release).toContain('softprops/action-gh-release@v3');
    for (const id of publishJobs) expect(needsOf(release), id).toContain(id);
    for (const id of publishJobs) {
      expect(jobs.get(id)).not.toContain('softprops/action-gh-release');
    }
  });
});
