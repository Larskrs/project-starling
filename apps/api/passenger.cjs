// This is to be used by hosting provider Plesk to startup the application

import("./dist/index.js").catch((err) => {
  console.error("Failed to start app:", err);
  process.exit(1);
});