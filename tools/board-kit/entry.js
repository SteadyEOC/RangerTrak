// E-255: the Board kit's entry point. build.js bundles this, tools/command-post-server.js and its
// npm dependencies into the kit's single rangertrak-board.js, so a coordinator needs Node.js and
// nothing else: no npm ci, no build. The server reads the kit folder (the bundle's own folder)
// for the app and the certificate; see KIT_DIR there.
process.env.RANGERTRAK_BOARD_KIT = process.env.RANGERTRAK_BOARD_KIT || __dirname;
require('../command-post-server').start();
