// E-255: RangerView's entry point. build.js bundles this, tools/command-post-server.js and its
// npm dependencies into the single rangerview.js, so a coordinator needs Node.js and
// nothing else: no npm ci, no build. The server reads its own folder (the bundle's folder)
// for the app and the certificate; see KIT_DIR there.
process.env.RANGERTRAK_BOARD_KIT = process.env.RANGERTRAK_BOARD_KIT || __dirname;
require('../command-post-server').start();
