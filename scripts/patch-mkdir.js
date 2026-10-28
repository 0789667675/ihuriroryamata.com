const fs = require('fs');

const origMkdir = fs.mkdir;
fs.mkdir = function(p, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  let attempts = 0;
  function attempt() {
    origMkdir(p, options, (err) => {
      if (err && (err.code === 'EPERM' || err.code === 'EBUSY') && attempts < 15) {
        attempts++;
        return setTimeout(attempt, 30);
      }
      if (callback) callback(err);
    });
  }
  attempt();
};

const origMkdirSync = fs.mkdirSync;
fs.mkdirSync = function(p, options) {
  let attempts = 0;
  while (true) {
    try {
      return origMkdirSync(p, options);
    } catch (err) {
      if ((err.code === 'EPERM' || err.code === 'EBUSY') && attempts < 15) {
        attempts++;
        try {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
        } catch {
          // fallback sync busy-wait if SharedArrayBuffer unavailable
          const start = Date.now();
          while (Date.now() - start < 30) {}
        }
        continue;
      }
      throw err;
    }
  }
};

if (fs.promises && fs.promises.mkdir) {
  const origPromisesMkdir = fs.promises.mkdir;
  fs.promises.mkdir = async function(p, options) {
    let attempts = 0;
    while (true) {
      try {
        return await origPromisesMkdir(p, options);
      } catch (err) {
        if ((err.code === 'EPERM' || err.code === 'EBUSY') && attempts < 15) {
          attempts++;
          await new Promise((r) => setTimeout(r, 30));
          continue;
        }
        throw err;
      }
    }
  };
}
