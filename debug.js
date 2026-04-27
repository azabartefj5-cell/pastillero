const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('PAGE ERROR:', msg.text());
    } else {
      console.log('PAGE LOG:', msg.text());
    }
  });

  page.on('pageerror', error => {
    console.log('PAGE EXCEPTION:', error.message);
  });

  page.on('response', response => {
    if (!response.ok()) {
      console.log('HTTP ERROR:', response.status(), response.url());
    }
  });

  console.log('Opening page...');
  await page.goto('http://127.0.0.1:8081');
  
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
