const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor(opts) {
    // Get user data path from Electron
    const userDataPath = app.getPath('userData');
    this.path = path.join(userDataPath, opts.configName + '.json');
    this.data = parseDataFile(this.path, opts.defaults);
  }
  
  get(key) {
    return this.data[key];
  }
  
  set(key, val) {
    this.data[key] = val;
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
  
  getAll() {
    return this.data;
  }
}

function parseDataFile(filePath, defaults) {
  try {
    const data = fs.readFileSync(filePath);
    return JSON.parse(data);
  } catch(error) {
    // If file doesn't exist or is corrupted, return defaults
    return defaults;
  }
}

module.exports = Store;