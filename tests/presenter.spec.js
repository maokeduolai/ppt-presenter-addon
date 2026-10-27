const {test,expect} = require('@playwright/test');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const {inflateSync} = require('node:zlib');
const base = 'http://127.0.0.1:8765/examples/';
async function start(page,url = base + 'index.html') {
  await page.goto(url);
  await expect(page.locator('.pp-launch')).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.locator('.pp-launch').click();
  const audience = await popup;
  await expect(page.locator('.pp-status')).toHaveAttribute('data-connected','true');
  return audience;
}
async function state(page) { return page.evaluate(()=>window.deck.getState()); }

async function backgroundPixel(page) {
  const bounds = await page.locator('.reveal').boundingBox();
  // Sample an empty corner below the content and above Reveal's progress bar.
  const png = await page.screenshot({clip:{x:Math.floor(bounds.x+bounds.width-10),y:Math.floor(bounds.y+bounds.height-10),width:1,height:1}});
  expect(png.readUInt32BE(16)).toBe(1); expect(png.readUInt32BE(20)).toBe(1);
  expect(png[24]).toBe(8); expect([2,6]).toContain(png[25]);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii',offset+4,offset+8) === 'IDAT') chunks.push(png.subarray(offset+8,offset+8+length));
    offset += length + 12;
  }
  // For the first pixel of the first row, all PNG filter neighbours are zero.
  return [...inflateSync(Buffer.concat(chunks)).subarray(1,4)];
}

async function expectCompositedBackground(page,normal) {
  // Alpha compositing in separate GPU surfaces can round by one channel value.
  await expect.poll(async()=>{
    const actual = await backgroundPixel(page);
    return Math.max(...actual.map((value,index)=>Math.abs(value-normal[index])));
  }).toBeLessThanOrEqual(2);
}

for (const [mode,url] of [['HTTP',base+'index.html'],['file',pathToFileURL(path.resolve('examples/index.html')).href]]) {
  test(`${mode}: transparent slides preserve the normal background in both windows`,async({page})=>{
    await page.goto(url); await expect(page.locator('.pp-launch')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    const normal = await backgroundPixel(page);
    await page.keyboard.press('ArrowLeft');
    const popup = page.waitForEvent('popup'); await page.locator('.pp-launch').click(); const audience = await popup;
    await expect(page.locator('.pp-status')).toHaveAttribute('data-connected','true');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async()=>(await state(audience)).indexh).toBe(1);
    expect(await backgroundPixel(page)).toEqual(normal);
    expect(await backgroundPixel(audience)).toEqual(normal);
    for (let index = 2; index < 5; index++) {
      await page.locator('.pp-thumb').nth(index).click();
      await expect.poll(async()=>await audience.evaluate(()=>deck.getSlides().indexOf(deck.getCurrentSlide()))).toBe(index);
      expect(await backgroundPixel(page)).toEqual(normal);
      expect(await backgroundPixel(audience)).toEqual(normal);
    }
    await page.getByRole('button',{name:'结束演示',exact:true}).click();
    expect(await backgroundPixel(page)).toEqual(normal);
  });
}

test('document gradient, deck background and Reveal slide background keep their paint order',async({page,context})=>{
  await context.route('**/examples/index.html*',async route=>{
    const response = await route.fetch();
    const html = (await response.text()).replace('</head>',`<style>
      html { background: #162f42; }
      body.reveal-viewport { background: linear-gradient(90deg, transparent 10%, #d8e9df80 80%); }
      .reveal { background: rgba(255,255,255,.2); }
    </style></head>`).replace('id="vertical-two"','id="vertical-two" data-background-color="#9ac5dc"');
    await route.fulfill({response,body:html});
  });
  await page.goto(base+'index.html'); await expect(page.locator('.pp-launch')).toBeVisible();
  await page.evaluate(()=>deck.slide(1,0));
  const normal = await backgroundPixel(page);
  const popup = page.waitForEvent('popup'); await page.locator('.pp-launch').click(); const audience = await popup;
  await expect(page.locator('.pp-status')).toHaveAttribute('data-connected','true');
  await expectCompositedBackground(page,normal);
  await expectCompositedBackground(audience,normal);
  await page.locator('.pp-thumb').nth(3).click();
  await expect.poll(async()=>(await state(audience)).indexv).toBe(1);
  await expect.poll(()=>backgroundPixel(page)).toEqual([154,197,220]);
  await expect.poll(()=>backgroundPixel(audience)).toEqual([154,197,220]);
  await page.locator('.pp-thumb').nth(4).click();
  await expect.poll(async()=>(await state(audience)).indexh).toBe(3);
  await expectCompositedBackground(page,normal);
  await expectCompositedBackground(audience,normal);
  await page.getByRole('button',{name:'结束演示',exact:true}).click();
});

test('HTTP: fragments, vertical navigation, reverse sync, pause, timer and cleanup', async ({page})=>{
  const errors = []; page.on('pageerror',e=>errors.push(e.message));
  const audience = await start(page); audience.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('.pp-thumb')).toHaveCount(5);
  await expect(page.locator('.pp-notes-scroll')).toContainText('Notes can be written in any language.');
  await expect(page.locator('#example-toolbar')).toBeHidden();
  await page.getByRole('button',{name:'2. 按你的节奏展开',exact:true}).click();
  await expect.poll(async()=>(await state(audience)).indexh).toBe(1);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async()=>(await state(audience)).indexf).toBe(0);
  await audience.keyboard.press('ArrowRight');
  await expect.poll(async()=>(await state(page)).indexf).toBe(1);
  await audience.keyboard.press('b');
  await expect.poll(async()=>(await state(page)).paused).toBe(true);
  await page.keyboard.press('b');
  await expect.poll(async()=>(await state(audience)).paused).toBe(false);
  await page.getByRole('button',{name:'4. 保持内容自由',exact:true}).click();
  await expect.poll(async()=>(await state(audience)).indexv).toBe(1);
  await expect(page.locator('.pp-notes-scroll')).toContainText('这是垂直组的第二页');
  await page.getByRole('button',{name:'开始计时',exact:true}).click();
  await expect(page.locator('.pp-timer-tools button').first()).toHaveText('暂停');
  await expect(page.locator('.pp-time-block').nth(1)).not.toContainText('00:00',{timeout:4000});
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('button',{name:'清零',exact:true}).click();
  await expect(page.locator('.pp-time-block').nth(1)).toContainText('00:00');
  await page.getByRole('button',{name:'放大备注字号',exact:true}).click();
  await expect(page.locator('.pp-font-value')).toHaveText('24px');
  await page.getByRole('button',{name:'5. 没有备注也能演讲',exact:true}).click();
  await expect(page.locator('.pp-empty')).toHaveText('本页暂无备注。');
  await page.getByRole('button',{name:'结束演示',exact:true}).click();
  await expect(page.locator('#pp-console')).toHaveCount(0);
  await expect(page.locator('#example-toolbar')).toBeVisible();
  expect(audience.isClosed()).toBe(true);
  expect(await page.evaluate(()=>({parent:deck.getRevealElement().parentElement.tagName,overview:deck.getConfig().overview,index:deck.getState().indexh}))).toEqual({parent:'BODY',overview:true,index:3});
  const second = page.waitForEvent('popup'); await page.locator('.pp-launch').click(); await second;
  await expect(page.locator('.pp-font-value')).toHaveText('24px');
  await expect(page.locator('.pp-empty')).toBeVisible();
  expect(errors).toEqual([]);
});

test('projection reload and reopen restore exact fragment; invalid messages are ignored',async({page})=>{
  let audience = await start(page);
  await page.evaluate(()=>{deck.slide(1,0,1);});
  await expect.poll(async()=>(await state(audience)).indexf).toBe(1);
  await audience.reload();
  await expect.poll(async()=>(await state(audience)).indexf).toBe(1);
  await audience.evaluate(()=>{
    const token = new URL(location.href).searchParams.get('__presenter_audience');
    opener.postMessage({channel:'html-presenter-v2',token,type:'state',state:{indexh:100,indexv:99,indexf:0,paused:false}},location.origin);
  });
  expect((await state(page)).indexh).toBe(1);
  await audience.close();
  await expect(page.locator('.pp-status')).toContainText('已关闭');
  const popup = page.waitForEvent('popup'); await page.getByRole('button',{name:'重新打开投影',exact:true}).click(); audience = await popup;
  await expect.poll(async()=>(await state(audience)).indexf).toBe(1);
  await page.getByRole('button',{name:'结束演示',exact:true}).click();
});

test('file:// works offline including both directions of synchronization',async({page})=>{
  const audience = await start(page,pathToFileURL(path.resolve('examples/index.html')).href);
  await page.getByRole('button',{name:'4. 保持内容自由',exact:true}).click();
  await expect.poll(async()=>(await state(audience)).indexv).toBe(1);
  await audience.keyboard.press('ArrowRight');
  await expect.poll(async()=>(await state(page)).indexh).toBe(3);
  await page.getByRole('button',{name:'结束演示',exact:true}).click();
});

test('explicit init, English UI, ID mapping, short external notes and inline fallback',async({page})=>{
  const audience = await start(page,base+'external-notes.html');
  await expect(page.locator('.pp-notes-scroll')).toContainText('come from a separate JavaScript file');
  await page.locator('.pp-thumb').nth(1).click();
  await expect(page.locator('.pp-notes-scroll')).toContainText('inline fallback');
  await page.locator('.pp-thumb').nth(2).click();
  await expect(page.locator('.pp-notes-scroll')).toContainText('Thank the audience');
  await expect(audience.locator('body')).toHaveClass(/pp-audience/);
  await page.getByRole('button',{name:'End presentation',exact:true}).click();
});

test('missing notes file degrades gracefully; original keyboard config survives',async({page})=>{
  // Set the missing file before the plugin starts.
  await page.route('**/presenter.js',async route=>{
    const response = await route.fetch();
    await route.fulfill({response,body:'window.HTMLPresenterConfig.notesFile="missing.js";\n'+await response.text()});
  });
  await page.goto(base+'index.html');
  await expect(page.locator('.pp-launch')).toBeVisible();
  await expect(page.locator('.pp-toast')).toContainText('无法加载');
  const before = await page.evaluate(()=>deck.getConfig().keyboard);
  const popup = page.waitForEvent('popup'); await page.locator('.pp-launch').click(); await popup;
  await expect(page.locator('.pp-notes-scroll')).toContainText('欢迎使用');
  await page.getByRole('button',{name:'结束演示',exact:true}).click();
  expect(await page.evaluate(()=>deck.getConfig().keyboard)).toEqual(before);
});

test('popup block leaves normal deck intact; print-pdf adds no UI',async({page})=>{
  await page.goto(base+'index.html'); await expect(page.locator('.pp-launch')).toBeVisible();
  await page.evaluate(()=>window.open=()=>null);
  await page.locator('.pp-launch').click();
  await expect(page.locator('.pp-toast')).toContainText('拦截');
  expect(await page.evaluate(()=>HTMLPresenter.active)).toBe(false);
  await expect(page.locator('#pp-console')).toHaveCount(0);
  await page.goto(base+'index.html?print-pdf');
  await page.waitForFunction(()=>window.deck?.isReady());
  await expect(page.locator('.pp-launch')).toHaveCount(0);
});
