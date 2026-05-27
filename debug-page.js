const { chromium } = require('playwright');

async function main() {
  const ctx = await chromium.launchPersistentContext('/home/reload/projects/jd-invoice/.browser-data', {
    headless: false,
    viewport: { width: 1400, height: 900 },
    executablePath: '/home/reload/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
  });
  
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://order.jd.com/center/list.action', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3000);
  
  // 获取页面 HTML 结构
  const html = await page.content();
  console.log('页面长度:', html.length);
  
  // 查找可能的订单元素
  const info = await page.evaluate(() => {
    const result = {
      url: window.location.href,
      title: document.title,
      // 查找各种可能的订单容器
      orderContainers: [],
      // 查找所有包含"订单"的元素
      orderTexts: [],
      // 查找所有表格
      tables: document.querySelectorAll('table').length,
      // 查找所有列表
      lists: document.querySelectorAll('ul, ol').length,
    };
    
    // 检查常见的订单容器类名
    const classNames = ['order-item', 'order-tb', 'order-list', 'order', 'j-order', 
                        'order-detail', 'orderbox', 'order-cont', 'tb-order'];
    classNames.forEach(cls => {
      const els = document.querySelectorAll('.' + cls);
      if (els.length > 0) {
        result.orderContainers.push({ class: cls, count: els.length });
      }
    });
    
    // 查找包含订单号的元素
    document.querySelectorAll('*').forEach(el => {
      const text = el.textContent || '';
      if (text.match(/\d{15,20}/) && el.children.length < 5) {
        result.orderTexts.push({
          tag: el.tagName,
          class: el.className,
          text: text.substring(0, 50)
        });
      }
    });
    
    return result;
  });
  
  console.log('\n页面信息:');
  console.log('  URL:', info.url);
  console.log('  标题:', info.title);
  console.log('  表格数:', info.tables);
  console.log('  列表数:', info.lists);
  console.log('  订单容器:', JSON.stringify(info.orderContainers));
  console.log('\n  可能的订单号元素:');
  info.orderTexts.slice(0, 10).forEach(t => {
    console.log('    ', t.tag, t.class, '|', t.text);
  });
  
  await new Promise(r => setTimeout(r, 60000));
  await ctx.close();
}

main().catch(e => console.error('错误:', e.message));
