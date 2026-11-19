import { createShadowRootUi, defineContentScript, type ShadowRootContentScriptUi } from '#imports';
import ReactDOM from 'react-dom/client';
import { browser } from 'wxt/browser';
import { App } from '../../components/App';
import '../../components/ui.css';
import { Controller } from '../../content/controller';
import { PINTEREST_MATCHES } from '../../lib/domains';
import type { ContentEvent } from '../../lib/messages';

declare global {
  interface Window {
    __pinterestHeist?: boolean;
  }
}

export default defineContentScript({
  matches: PINTEREST_MATCHES,
  cssInjectionMode: 'ui',
  runAt: 'document_idle',

  async main(ctx) {
    // The background may inject this script into tabs opened before install; run once per page.
    if (window.__pinterestHeist) return;
    window.__pinterestHeist = true;

    let ui: ShadowRootContentScriptUi<ReactDOM.Root> | null = null;
    let mounting: Promise<void> | null = null;

    const controller = new Controller({
      mount: () => {
        if (ui || mounting) return;
        mounting = createShadowRootUi(ctx, {
          name: 'pinterest-heist-ui',
          position: 'inline',
          anchor: 'html',
          append: 'last',
          isolateEvents: ['keydown', 'keyup', 'keypress'],
          onMount(container) {
            const host = document.createElement('div');
            host.setAttribute('data-heist-ui', '');
            container.append(host);
            const root = ReactDOM.createRoot(host);
            root.render(<App ctl={controller} />);
            return root;
          },
          onRemove(root) {
            root?.unmount();
          },
        }).then((created) => {
          created.shadowHost.setAttribute('data-heist-ui', '');
          created.mount();
          ui = created;
          mounting = null;
          if (!controller.isActive()) {
            ui.remove();
            ui = null;
          }
        });
      },
      unmount: () => {
        ui?.remove();
        ui = null;
      },
    });

    browser.runtime.onMessage.addListener((msg: ContentEvent) => {
      if (msg?.type === 'heist:set-active') {
        if (msg.active) void controller.activate();
        else controller.deactivate();
      } else if (msg?.type === 'heist:zip-progress' || msg?.type === 'heist:zip-done') {
        controller.onEvent(msg);
      }
    });

    // Pinterest is a single-page app: follow its in-page navigation.
    ctx.addEventListener(window, 'wxt:locationchange', () => controller.onLocationChange());

    // Stay on after a reload if the user turned it on for this tab.
    try {
      const state = await browser.runtime.sendMessage({ type: 'heist:state' });
      if (state?.active) await controller.activate();
    } catch {
      /* background not ready; the toolbar button still works */
    }

    ctx.onInvalidated(() => controller.deactivate());
  },
});
