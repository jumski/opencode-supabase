// Import-aware host-runtime specifier rewriting for the packed TUI bundle.
//
// OpenCode's host exposes OpenTUI/Solid singletons to plugins as virtual
// `opentui:runtime-module:*` modules. The packed bundle must reference those
// virtual ids instead of bare specifiers so the host-owned singletons are used.
//
// This module is plain ESM with no Bun-only imports: `transform-solid.mjs`
// runs under plain Node (spawned by `build.ts`), and `@opentui/core` entry
// points are Bun-only. `runtimeModuleIdForSpecifier` is byte-compatible with
// `@opentui/core/runtime-plugin` (parity asserted in test/build-transform.test.ts).

export const hostRuntimeSpecifiers = [
  "@opentui/core",
  "@opentui/solid",
  "@opentui/solid/components",
  "@opentui/solid/jsx-runtime",
  "@opentui/solid/jsx-dev-runtime",
  "solid-js",
  "solid-js/store",
];

const hostRuntimeSpecifierSet = new Set(hostRuntimeSpecifiers);

export const runtimeModuleIdForSpecifier = (specifier) =>
  `opentui:runtime-module:${encodeURIComponent(specifier)}`;

const rewriteSpecifier = (value) =>
  typeof value === "string" && hostRuntimeSpecifierSet.has(value) ? runtimeModuleIdForSpecifier(value) : null;

const rewriteSourceNode = (node) => {
  if (!node) return;
  const rewritten = rewriteSpecifier(node.value);
  if (rewritten) node.value = rewritten;
};

// Babel plugin: rewrites only real module specifiers — static imports/exports,
// side-effect imports, dynamic import(), and require() calls. Arbitrary string
// literals elsewhere in the file are never touched.
export default function hostRuntimeRewrite() {
  return {
    name: "host-runtime-rewrite",
    visitor: {
      ImportDeclaration(path) {
        rewriteSourceNode(path.node.source);
      },
      ExportNamedDeclaration(path) {
        rewriteSourceNode(path.node.source);
      },
      ExportAllDeclaration(path) {
        rewriteSourceNode(path.node.source);
      },
      ImportExpression(path) {
        if (path.node.source.type === "StringLiteral") rewriteSourceNode(path.node.source);
      },
      CallExpression(path) {
        const callee = path.node.callee;
        const isRequire = callee.type === "Identifier" && callee.name === "require";
        const isDynamicImport = callee.type === "Import";
        if (!isRequire && !isDynamicImport) return;
        const [arg] = path.node.arguments;
        if (arg?.type === "StringLiteral") rewriteSourceNode(arg);
      },
    },
  };
}
