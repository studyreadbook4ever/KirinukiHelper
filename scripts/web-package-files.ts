import { WEB_JAVASCRIPT_PATHS } from "./web-javascript-build.js";

export const WEB_PACKAGE_FILES = Object.freeze([
  ".popovic-hosts",
  "THIRD_PARTY_NOTICES.md",
  "_headers",
  "editor.html",
  "editor/editor.css",
  "editor/fonts/Paperlogy-8ExtraBold.woff2",
  "editor/fonts/Pretendard-ExtraBold.woff2",
  "index.html",
  "licenses.css",
  "licenses.html",
  "privacy.html",
  "licenses/AUDSEG-MIT.txt",
  "licenses/HLS-JS-APACHE-2.0.txt",
  "licenses/MEDIABUNNY-MPL-2.0.txt",
  "licenses/PAPERLOGY-OFL-1.1.txt",
  "licenses/PRETENDARD-OFL-1.1.txt",
  "licenses/UNLICENSE.txt",
  "studio.css",
  ...WEB_JAVASCRIPT_PATHS
].sort());

export interface PublicWebPackageFile {
  readonly archivePath: string;
  readonly sourcePath: string;
}

export const PUBLIC_WEB_PACKAGE_FILES = Object.freeze([
  ...WEB_PACKAGE_FILES.map((relativePath) => ({
    sourcePath: `web/${relativePath}`,
    archivePath: relativePath
  }))
] satisfies readonly PublicWebPackageFile[]);
