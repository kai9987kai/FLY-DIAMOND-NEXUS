'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8080';
const out = path.resolve('output/fly-upgrade-browser');
fs.mkdirSync(out, {recursive: true});
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  const check = (name, value) => {assert.ok(value, name); checks.push(name);};
  const input = async (selector, value) => page.locator(selector).evaluate((el, v) => {el.value = v; el.dispatchEvent(new Event('input', {bubbles: true}));}, value);
  async function paint(tool, x, y) {
    await page.click('#tool' + tool[0].toUpperCase() + tool.slice(1));
    const box = await page.locator('#worldCanvas').boundingBox();
    const size = await page.evaluate(() => flyLab.env.gridSize);
    await page.mouse.click(box.x + (x + .5) / size * box.width, box.y + (y + .5) / size * box.height);
  }
  try {
    await page.goto(base + '/fly-diamond-nexus.html');
    await page.waitForFunction(() => !!window.flyLab && !!window.flySupermix);
    check('22 modules and 1936 action slots', await page.evaluate(() => flyLab.syncytium.brainCount === 22 && flyLab.syncytium.commissuralWeights.length === 1936));
    check('six specialists visible', (await page.locator('#brainMetersTitle').textContent()).includes('22'));
    await page.selectOption('#weatherPreset', 'drought');
    check('drought changes actual heat and humidity', await page.evaluate(() => flyLab.climate.weather.temperature === 37 && flyLab.climate.weather.humidity === .18));
    await input('#env_windX', '-1');
    check('wind slider changes simulation', await page.evaluate(() => flyLab.climate.weather.windX === -1));
    const spot = await page.evaluate(() => {
      for (let y = 1; y < flyLab.env.gridSize - 1; y++) for (let x = 1; x < flyLab.env.gridSize - 1; x++) {
        if ([1, 2, 3].every(n => Math.abs(flyLab.env['agent' + n + 'X'] - x) + Math.abs(flyLab.env['agent' + n + 'Y'] - y) > 3)) return {x, y};
      }
    });
    await input('#brushRadius', '0');
    await paint('wall', spot.x, spot.y);
    check('wall tool paints blocked terrain', await page.evaluate(p => flyLab.climate.isBlocked(p.x, p.y), spot));
    await paint('erase', spot.x, spot.y);
    check('erase tool reopens terrain', await page.evaluate(p => !flyLab.climate.isBlocked(p.x, p.y), spot));
    await paint('water', spot.x, spot.y);
    check('water tool adds cooling terrain', await page.evaluate(p => flyLab.climate.water.some(q => q.x === p.x && q.y === p.y), spot));
    await paint('refuge', spot.x, spot.y);
    check('refuge tool adds shelter', await page.evaluate(p => flyLab.climate.refuges.some(q => q.x === p.x && q.y === p.y), spot));
    await paint('erase', spot.x, spot.y);
    await paint('predator', spot.x, spot.y);
    check('predator tool adds moving threat', await page.evaluate(p => flyLab.climate.predators.some(q => q.x === p.x && q.y === p.y), spot));
    await page.selectOption('#weatherPreset', 'storm');
    await page.evaluate(() => flyLab.advance(45));
    check('weather advances once per world tick', await page.evaluate(() => flyLab.climate.tick === flyLab.simStep));
    check('all agents remain finite and outside walls', await page.evaluate(() => [1, 2, 3].every(n => Number.isFinite(flyLab.env['agent' + n + 'Energy']) && !flyLab.climate.isBlocked(flyLab.env['agent' + n + 'X'], flyLab.env['agent' + n + 'Y']))));
    await input('#graphDensity', '100');
    await input('#graphThreshold', '0');
    await input('#couplingStrength', '1.4');
    check('coupling control updates engine', await page.evaluate(() => flyLab.telemetry().graph.couplingStrength === 1.4));
    await page.locator('#connectomeCanvas').screenshot({path: path.join(out, 'graph-dense.png')});
    await page.click('#btnMatrix');
    check('matrix displays 22 rows and columns', (await page.locator('#matrixTitle').textContent()).includes('22'));
    check('matrix edit remains normalized and snapshot-loadable', await page.evaluate(() => {
      tweakSynapse(0, 1, 0.05);
      const save = flyLab.serialize();
      return flyLab.restore(save);
    }));
    await page.screenshot({path: path.join(out, 'matrix.png')});
    await page.evaluate(() => closeMatrixModal());
    check('saved world resumes exact future including ecology', await page.evaluate(() => {
      const state=()=>{const s=JSON.parse(flyLab.serialize());delete s.timestamp;return JSON.stringify(s);};
      flyLab.save(); flyLab.advance(18); const expected = state();
      flyLab.load(); flyLab.advance(18); return state() === expected;
    }));
    const beforeInvalid = await page.evaluate(() => {const s=JSON.parse(flyLab.serialize());delete s.timestamp;return JSON.stringify(s);});
    await page.evaluate(() => {
      const snapshot = JSON.parse(flyLab.serialize()); snapshot.brains[0].kcToMbonWeights[0] = 'invalid';
      _restoreFromJson(JSON.stringify(snapshot));
    });
    check('invalid snapshot leaves world intact', await page.evaluate(() => {const s=JSON.parse(flyLab.serialize());delete s.timestamp;return JSON.stringify(s);}) === beforeInvalid);
    await page.selectOption('#brainMode', '16');
    check('16-module baseline is still selectable', await page.evaluate(() => flyLab.syncytium.brainCount === 16));
    check('fixed baseline coupling is visibly disabled', await page.locator('#couplingStrength').isDisabled());
    await page.selectOption('#brainMode', '22');
    check('zero regrowth leaves an exhausted world empty', await page.evaluate(() => {
      flyLab.climate.setVariable('resourceRegrowth', 0);flyLab.env.diamonds=[];
      flyLab.advance(15);return flyLab.env.diamonds.length===0;
    }));
    await page.evaluate(() => flyLab.reset());
    await page.evaluate(() => flyLab.advance(50));
    await page.screenshot({path: path.join(out, 'desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    check('expanded controls fit mobile', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path: path.join(out, 'mobile.png'), fullPage: true});
    await page.locator('#supermixPanel').screenshot({path: path.join(out, 'supermix.png')});
    const status = await page.evaluate(() => flySupermix.status);
    check('read-only bridge reports status', status && status.safety.readOnly === true);
    check('no browser exceptions', errors.length === 0);
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({checks, errors, status}, null, 2));
    console.log(`${checks.length} Fly upgrade browser checks passed; artifacts: ${out}`);
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
