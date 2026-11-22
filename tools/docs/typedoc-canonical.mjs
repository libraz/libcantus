/**
 * TypeDoc plugin: a canonical link on every generated page.
 *
 * TypeDoc emits one only on index.html; with this each page names its own
 * absolute URL under `hostedBaseUrl`.
 */
import { JSX } from 'typedoc';

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.renderer.hooks.on('head.begin', (context) => {
    const base = app.options.getValue('hostedBaseUrl');
    if (!base || context.page.url === 'index.html') {
      return JSX.createElement(JSX.Fragment, null);
    }
    return JSX.createElement('link', {
      rel: 'canonical',
      href: new URL(context.page.url, base).href,
    });
  });
}
