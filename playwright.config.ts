import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.e2e.spec.ts', fullyParallel: false, workers: 1,
  retries: process.env.CI ? 1 : 0, timeout: 240_000,
  reporter: [['list'], ['html', {open:'never'}]],
  use: { baseURL: 'http://127.0.0.1:4173', viewport:{width:1440,height:900}, actionTimeout:30_000, navigationTimeout:45_000, screenshot:'only-on-failure', video:'retain-on-failure', trace:'retain-on-failure',
    launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']} },
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}}],
  webServer:{command:'npm run dev',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,timeout:60_000},
});
