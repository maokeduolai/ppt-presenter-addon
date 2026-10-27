const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir:'./tests', testMatch:'**/*.spec.js', fullyParallel:false, workers:1,
  timeout:30000, use:{browserName:'chromium',headless:true,viewport:{width:1440,height:1000}},
  webServer:{command:'python3 -m http.server 8765 --bind 127.0.0.1',url:'http://127.0.0.1:8765',reuseExistingServer:!process.env.CI},
});
