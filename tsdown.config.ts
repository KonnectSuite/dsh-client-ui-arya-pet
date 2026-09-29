import { defineConfig } from 'tsdown'

const packageName = '@deepseek-ai/dsh-client-ui-arya-pet'

/**
 * The interim build for a browser half that is still upstream JavaScript.
 *
 * Every other client package gets the loader contract from the shared preset in
 * `packages/client/tsdown.client.ts` (`clientBundle`), whose Client entry is
 * fixed at `src/client/index.ts` (or `lib/types/client/index.js` on the built
 * face). This package's browser half is `src/client.js` — imported, untyped
 * JavaScript — so it cannot be handed to that preset without porting it first.
 * Until it is, the three pieces of the contract are restated here, copied from
 * that preset's `clientConfig`:
 *
 * - `format: 'cjs'` with the `module`/`exports` intro, so the bundle assigns to
 *   `module.exports` what the factory returns;
 * - the banner/footer that register the package under its own id through
 *   `window.__ModuleLoader__.load` and hand the body the module table's
 *   `require`;
 * - the baseline specifiers left as `require(...)`
 *   (`packages/client/web/src/platform.ts` PLATFORM_MODULES). This plugin
 *   imports only `react` and `react-dom`; every other dependency inlines, which
 *   is also what the preset's `alwaysBundle` rule does.
 *
 * Without this the artifact keeps bare ESM imports, and the browser cannot
 * resolve them: the entry fails to load and the whole web boot fails with it,
 * which is why the bundle row ships disabled.
 *
 * Durable shape, once the browser half is TypeScript: delete this file and
 * replace it with `clientBundle(packageName, ['lib/types/index.js'])`.
 */
export default defineConfig([
  {
    name: packageName,
    entry: { index: 'src/index.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    outputOptions: { codeSplitting: false },
    dts: false,
    clean: false,
  },
  {
    name: `${packageName}/client`,
    entry: { client: 'src/client.js' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    // The loader module table answers only the baseline specifiers, so anything
    // else must ride inside the bundle or throw at runtime.
    deps: {
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
      alwaysBundle: () => true,
    },
    // Browser bundles inline dependencies that probe these (zustand and friends
    // read process.env.NODE_ENV and import.meta.env.MODE), which a CJS output
    // cannot carry unresolved.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      codeSplitting: false,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
    },
  },
])
