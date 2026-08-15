import { WEB_JAVASCRIPT_PATHS } from "./web-javascript-build.js";

export const WEB_PACKAGE_FILES = Object.freeze([
  "THIRD_PARTY_NOTICES.md",
  "editor.html",
  "editor/editor.css",
  "editor/fonts/Paperlogy-8ExtraBold.woff2",
  "editor/fonts/Pretendard-ExtraBold.woff2",
  "index.html",
  "licenses.css",
  "licenses.html",
  "licenses/AUDSEG-MIT.txt",
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
  {
    sourcePath: "public-shell/index.html",
    archivePath: "index.html"
  },
  {
    sourcePath: "public-shell/public.css",
    archivePath: "public.css"
  },
  {
    sourcePath: "public-shell/THIRD_PARTY_NOTICES.md",
    archivePath: "THIRD_PARTY_NOTICES.md"
  },
  {
    sourcePath: "public-shell/licenses/UNLICENSE.txt",
    archivePath: "licenses/UNLICENSE.txt"
  },
  {
    sourcePath: "public-shell/.popovic-hosts",
    archivePath: ".popovic-hosts"
  },
  {
    sourcePath: "public-shell/_headers",
    archivePath: "_headers"
  }
] satisfies readonly PublicWebPackageFile[]);
