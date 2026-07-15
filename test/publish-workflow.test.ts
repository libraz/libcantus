import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  fileURLToPath(new URL('../.github/workflows/publish.yml', import.meta.url)),
  'utf8',
);

describe('publish workflow privilege and state transitions', () => {
  it('builds read-only and publishes the exact uploaded artifact', () => {
    const verify = workflow.slice(
      workflow.indexOf('  verify:'),
      workflow.indexOf('  publish-npm:'),
    );
    const publish = workflow.slice(workflow.indexOf('  publish-npm:'));
    expect(verify).toContain('contents: read');
    expect(verify).not.toContain('id-token: write');
    expect(verify).toContain('npm pack --ignore-scripts');
    expect(verify).toContain('actions/upload-artifact@v7');
    expect(publish).toContain('needs: verify');
    expect(publish).toContain('actions/download-artifact@v8');
    expect(publish).not.toContain('actions/checkout');
    expect(publish).not.toContain('yarn install');
  });

  it('makes retries idempotent and creates the release only after npm publication', () => {
    const view = workflow.indexOf('npm view "$name@$version"');
    const npmPublish = workflow.indexOf('npm publish "$tarball"');
    const release = workflow.indexOf('softprops/action-gh-release@v3');
    expect(view).toBeGreaterThan(0);
    expect(npmPublish).toBeGreaterThan(view);
    expect(release).toBeGreaterThan(npmPublish);
  });
});
