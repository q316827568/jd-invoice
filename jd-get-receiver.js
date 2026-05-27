const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BROWSER_DATA = path.join(__dirname, '.browser-data');
const ORDERS_FILE = path.join(__dirname, 'jd-orders.json');
const OUTPUT_FILE = path.join(__dirname, 'jd-orders-with-receiver.json');

async function main() {
  const ordersData = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  const orders = ordersData.allOrders || ordersData.orders || [];
  
  console.log(`开始处理 ${orders.length} 个订单...`);
  
  const ctx = await chromium.launchPersistentContext(BROWSER_DATA, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    executablePath: '/home/reload/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
  });
  
  const page = ctx.pages()[0] || await ctx.newPage();
  
  const results = [];
  
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    process.stdout.write(`\r[${i+1}/${orders.length}] 处理订单 ${order.orderId}...`);
    
    try {
      // 构建订单详情URL
      const detailUrl = `https://details.jd.com/normal/item.action?orderid=${order.orderId}`;
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000);
      
      // 获取收货人信息
      const receiverInfo = await page.evaluate(() => {
        // 收货人通常在订单详情页面
        const receiverEl = document.querySelector('.consignee, .addr-detail, .order-addr');
        if (receiverEl) {
          return receiverEl.textContent.trim();
        }
        
        // 尝试其他选择器
        const addrEl = document.querySelector('.addr, .address, [class*="address"]');
        if (addrEl) {
          return addrEl.textContent.trim();
        }
        
        // 查找包含"收货"的元素
        const labels = Array.from(document.querySelectorAll('td, div, span'));
        for (const el of labels) {
          const text = el.textContent || '';
          if (text.includes('收货人') || text.includes('收货地址') || text.includes('台州')) {
            return text.substring(0, 100);
          }
        }
        
        return '';
      });
      
      // 检查是否包含台州振鹏
      const isTarget = receiverInfo.includes('台州振鹏') || receiverInfo.includes('振鹏单向器');
      
      results.push({
        ...order,
        receiver: receiverInfo.substring(0, 200),
        isTarget
      });
      
      if (isTarget) {
        console.log(`\n  ✓ 匹配: 台州振鹏`);
      }
      
    } catch (e) {
      results.push({
        ...order,
        receiver: '',
        isTarget: false,
        error: e.message
      });
    }
  }
  
  console.log('\n\n处理完成！');
  
  // 筛选目标订单
  const matched = results.filter(r => r.isTarget);
  const matchedAmount = matched.reduce((sum, o) => sum + parseFloat(o.amount || 0), 0);
  
  console.log(`匹配"台州振鹏单向器有限公司": ${matched.length} 个`);
  console.log(`总金额: ¥${matchedAmount.toFixed(2)}`);
  
  // 保存结果
  const output = {
    total: orders.length,
    matched: matched.length,
    matchedAmount: matchedAmount.toFixed(2),
    orders: matched,
    allOrders: results
  };
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`结果已保存: ${OUTPUT_FILE}`);
  
  await ctx.close();
}

main().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
