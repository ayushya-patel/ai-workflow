const { execSync } = require("child_process")
execSync("git config core.hooksPath .githooks")
