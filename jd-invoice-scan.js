const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BROWSER_DATA = path.join(__dirname, '.browser-data');
const OUTPUT_FILE = path.join(__dirname, 'jd-orders.json');

async function main() {
  console.log('启动浏览器...');
  
  const ctx = await chromium.launchPersistentContext(BROWSER_DATA, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    executablePath: '/home/reload/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
  });
  
  const page = ctx.pages()[0] || await ctx.newPage();
  
  // 检查是否已登录
  console.log('当前页面:', page.url());
  
  // 导航到订单页面
  console.log('打开京东...');
  await page.goto('https://order.jd.com/center/list.action', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  
  // 检查是否需要登录
  const currentUrl = page.url();
  if (currentUrl.includes('passport.jd.com') || currentUrl.includes('login')) {
    console.log('⚠️  需要登录！请在浏览器中扫码登录京东...');
    // 等待登录完成，最多等10分钟
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(5000);
      const url = page.url();
      if (url.includes('order.jd.com') || url.includes('jd.com/center')) {
        console.log('✅ 登录成功！');
        break;
      }
      if (i === 119) {
        console.log('❌ 登录超时');
        await ctx.close();
        return;
      }
    }
  } else {
    console.log('已登录');
  }
  
  console.log('正在扫描订单...');
  
  // 等待订单表格加载
  await page.waitForSelector('.order-tb', { timeout: 30000 }).catch(() => {
    console.log('警告: 未找到订单表格');
  });
  await page.waitForTimeout(3000);
  
  const allOrders = [];
  let pageNum = 1;
  
  while (true) {
    console.log(`扫描第 ${pageNum} 页...`);
    await page.waitForTimeout(3000);
    
    // 打印页面内容调试
    const debug = await page.evaluate(() => {
      const table = document.querySelector('.order-tb');
      const tbodies = table?.querySelectorAll('tbody') || [];
      const first = tbodies[0];
      return {
        tableExists: !!table,
        tbodyCount: tbodies.length,
        firstTbodyHtml: first?.innerHTML?.substring(0, 1000) || 'no tbody',
        // 尝试找订单号
        numberSpan: first?.querySelector('span.number')?.textContent || 'not found',
        numberClass: first?.querySelector('.number')?.textContent || 'not found',
        allNumbers: Array.from(first?.querySelectorAll('span') || []).map(s => s.textContent?.trim()).slice(0, 5)
      };
    });
    console.log('  调试:', JSON.stringify(debug, null, 2));
    
    // 获取当前页订单
    const orders = await page.evaluate(() => {
      const results = [];
      const orderTable = document.querySelector('.order-tb');
      if (!orderTable) return results;
      
      const orderBodies = orderTable.querySelectorAll('tbody');
      
      orderBodies.forEach(tbody => {
        try {
          // 获取订单号 - 在 span.number > a 里面
          const orderIdLink = tbody.querySelector('span.number a');
          const orderId = orderIdLink?.textContent?.trim() || '';
          
          // 获取订单日期 - 在 span.dealtime
          const dateEl = tbody.querySelector('span.dealtime');
          const orderDate = dateEl?.textContent?.trim() || '';
          
          // 获取金额 - 在 span.order-count em
          const amountEl = tbody.querySelector('span.order-count em');
          let amount = amountEl?.textContent?.replace(/[^\d.]/g, '') || '0';
          
          // 获取店铺名
          const shopEl = tbody.querySelector('.order-shop .shop-txt, .order-shop a');
          const shopName = shopEl?.textContent?.trim() || '京东';
          
          // 获取订单链接
          const orderUrl = orderIdLink?.href || '';
          
          // 获取收货人 - 需要在详情页面，这里暂时无法获取
          // 可以从页面中查找收货地址相关的信息
          const receiver = '';
          
          if (orderId && orderId.length > 10) {
            results.push({
              orderId,
              amount,
              shopName,
              orderDate: orderDate.substring(0, 10),
              orderUrl,
              receiver
            });
          }
        } catch (e) {}
      });
      
      return results;
    });
    
    console.log(`  找到 ${orders.length} 个订单`);
    allOrders.push(...orders);
    
    // 查找下一页按钮
    const nextBtn = await page.$('.next:not(.disabled), .pn-next:not(.disabled), a.next');
    if (!nextBtn) {
      console.log('没有下一页了');
      break;
    }
    
    // 点击下一页
    await nextBtn.click();
    await page.waitForTimeout(2000);
    pageNum++;
    
    if (pageNum > 50) {
      console.log('达到最大页数限制');
      break;
    }
  }
  
  console.log(`\n总共扫描到 ${allOrders.length} 个订单`);
  
  // 筛选台州振鹏的订单
  const filtered = allOrders.filter(o => 
    o.receiver.includes('台州振鹏') || 
    o.receiver.includes('振鹏单向器') ||
    o.receiver.includes('台州') && o.receiver.includes('振鹏')
  );
  
  console.log(`匹配"台州振鹏单向器有限公司"的订单: ${filtered.length} 个`);
  
  // 保存结果
  const result = {
    total: allOrders.length,
    matched: filtered.length,
    matchedAmount: filtered.reduce((sum, o) => sum + parseFloat(o.amount || 0), 0).toFixed(2),
    orders: filtered,
    allOrders: allOrders
  };
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`结果已保存到: ${OUTPUT_FILE}`);
  
  // 打印匹配的订单
  if (filtered.length > 0) {
    console.log('\n匹配的订单:');
    filtered.forEach(o => {
      console.log(`  ${o.orderDate} | ¥${o.amount} | ${o.orderId} | 发票:${o.hasInvoice ? '有' : '无'}`);
    });
  }
  
  await ctx.close();
}

main().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
