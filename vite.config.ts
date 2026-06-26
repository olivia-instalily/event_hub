import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// @instalily/ui ships raw .tsx that imports the CommonJS @base-ui/react. Because those
// imports originate inside node_modules, Vite's dep scanner doesn't find them, so it would
// serve @base-ui raw — and native ESM can't read named exports off its CJS deps (e.g.
// use-sync-external-store/shim). Pre-bundling the Base UI entry points fixes that.
const baseUiEntries = [
  'accordion', 'alert-dialog', 'avatar', 'button', 'checkbox', 'collapsible',
  'context-menu', 'dialog', 'direction-provider', 'input', 'menu', 'menubar',
  'merge-props', 'navigation-menu', 'popover', 'preview-card', 'progress', 'radio',
  'radio-group', 'scroll-area', 'select', 'separator', 'slider', 'switch', 'tabs',
  'toggle', 'toggle-group', 'tooltip', 'use-render',
].map((e) => `@base-ui/react/${e}`);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: [
      ...baseUiEntries,
      'use-sync-external-store/shim',
      'use-sync-external-store/shim/with-selector',
    ],
  },
});
