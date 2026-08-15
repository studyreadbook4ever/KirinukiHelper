// Compatibility entrypoint for older local automation. The only editor
// distribution is now the localhost/static web app.
import { buildWebDistribution } from "./build-web.js";

await buildWebDistribution();
