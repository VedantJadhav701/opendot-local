const Module = require("module");
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "server-only") {
    return {};
  }
  return origRequire.apply(this, arguments);
};
