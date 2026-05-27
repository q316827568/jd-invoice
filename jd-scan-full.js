/**
 * 京东订单完整扫描
 * - 正确获取金额、收货人、商品名称
 * - 筛选指定收货人的订单
 * - 支持有头模式（WSLg）
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'jd-orders-full.json');
const BROWSER_DATA = path.join(__dirname, '.browser-data');

// 目标收货人关键词
const TARGET_KEYWORDS = ['台州振鹏', '振鹏单向器', '台州振鹏单向器有限公司'];

async function main() {
  console.log('京东订单完整扫描\n');
  
  const ctx = await chromium.launchPersistentContext(BROWSER_DATA, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    executablePath: '/home/reload/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
  });
  
  const page = ctx.pages()[0] || await ctx.newPage();
  
  // 打开订单列表
  console.log('打开京东订单页面...');
  await page.goto('https://order.jd.com/center/list.action', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  // 检查是否需要登录
  const loginBtn = await page.$('.login-btn, a[href*="login"]');
  if (loginBtn) {
    console.log('请先登录京东账号，登录后按回车继续...');
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
  }
  
  const allOrders = [];
  let pageNum = 1;
  let noNewOrders = 0;
  
  // 滚动加载所有订单
  console.log('\n滚动加载订单...');
  
  while (noNewOrders < 3) {
    // 滚动到底部
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
    
    // 提取当前可见的订单
    const pageOrders = await page.evaluate(() => {
      const orderEls = document.querySelectorAll('.order-tb');
      const results = [];
      
      for (const el of orderEls) {
        try {
          // 订单号
          const orderIdEl = el.querySelector('.tr-th .number a');
          const orderId = orderIdEl ? orderIdEl.textContent.trim() : '';
          
          // 订单日期
          const dateEl = el.querySelector('.tr-th .dealtime');
          const orderDate = dateEl ? dateEl.textContent.trim().split(' ')[0] : '';
          
          // 店铺名
          const shopEl = el.querySelector('.tr-th .shop-name a, .tr-th .shop a');
          const shopName = shopEl ? shopEl.textContent.trim() : '京东';
          
          // 金额 - 在订单商品区域
          const amountEl = el.querySelector('.amount, .order-summary .price, .goods-summary .price');
          let amount = amountEl ? amountEl.textContent.trim() : '0';
          amount = amount.replace(/[¥￥,]/g, '');
          
          // 商品名称
          const goodsEl = el.querySelector('.goods-list .goods-item .p-name a, .goods-list .p-name');
          const goodsName = goodsEl ? goodsEl.textContent.trim() : '';
          
          // 收货人 - 需要从订单详情获取，这里先留空
          const receiver = '';
          
          // 订单链接
          const orderUrl = `https://details.jd.com/normal/item.action?orderid=${orderId}`;
          
          if (orderId) {
            results.push({
              orderId,
              orderDate,
              shopName,
              amount,
              goodsName,
              receiver,
              orderUrl
            });
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
      
      return results;
    });
    
    // 去重合并
    let newCount = 0;
    for (const order of pageOrders) {
      if (!allOrders.find(o => o.orderId === order.orderId)) {
        allOrders.push(order);
        newCount++;
      }
    }
    
    if (newCount === 0) {
      noNewOrders++;
    } else {
      noNewOrders = 0;
    }
    
    process.stdout.write(`\r已加载: ${allOrders.length} 单 (本页新增: ${newCount})`);
    pageNum++;
    
    // 最多滚动50次
    if (pageNum > 50) break;
  }
  
  console.log(`\n\n订单列表加载完成，共 ${allOrders.length} 单`);
  
  // 获取每个订单的详细信息和收货人
  console.log('\n获取订单详情（收货人、金额、商品）...\n');
  
  for (let i = 0; i < allOrders.length; i++) {
    const order = allOrders[i];
    process.stdout.write(`\r[${i + 1}/${allOrders.length}] ${order.orderId}...`);
    
    try {
      await page.goto(order.orderUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(800);
      
      const detail = await page.evaluate(() => {
        let receiver = '';
        let amount = '0';
        let goodsName = '';
        
        // 收货人
        const addrSection = document.querySelector('.order-addr, .consignee-info, .addr-detail');
        if (addrSection) {
          receiver = addrSection.textContent.trim();
        }
        
        // 尝试更多收货人选择器
        if (!receiver) {
          const receiverEl = document.querySelector('.consignee, .addr-name, [class*="consignee"]');
          if (receiverEl) {
            receiver = receiverEl.textContent.trim();
          }
        }
        
        // 查找包含"收货人"的文本
        if (!receiver) {
          const allText = document.body.innerText;
          const match = allText.match(/收货人[：:]\s*([^\n]+)/);
          if (match) {
            receiver = match[1].trim();
          }
        }
        
        // 金额
        const amountEl = document.querySelector('.order-summary .price, .amount-sum, .order-total');
        if (amountEl) {
          amount = amountEl.textContent.trim().replace(/[¥￥,]/g, '');
        }
        
        // 尝试更多金额选择器
        if (amount === '0') {
          const priceEl = document.querySelector('.price-sum, .total-price, [class*="total"]');
          if (priceEl) {
            amount = priceEl.textContent.trim().replace(/[¥￥,]/g, '');
          }
        }
        
        // 商品名称
        const goodsEl = document.querySelector('.goods-info .p-name, .goods-name, .product-name');
        if (goodsEl) {
          goodsName = goodsEl.textContent.trim();
        }
        
        return { receiver, amount, goodsName };
      });
      
      // 更新订单信息
      order.receiver = detail.receiver.substring(0, 100);
      if (detail.amount && detail.amount !== '0') {
        order.amount = detail.amount;
      }
      if (detail.goodsName) {
        order.goodsName = detail.goodsName;
      }
      
      // 判断是否为目标收货人
      order.isTarget = TARGET_KEYWORDS.some(k => order.receiver.includes(k));
      
    } catch (e) {
      order.error = e.message;
      order.isTarget = false;
    }
  }
  
  // 筛选目标订单
  const targetOrders = allOrders.filter(o => o.isTarget);
  const targetAmount = targetOrders.reduce((sum, o) => sum + parseFloat(o.amount || 0), 0);
  
  console.log('\n\n========== 扫描完成 ==========');
  console.log(`总订单数: ${allOrders.length}`);
  console.log(`目标订单: ${targetOrders.length} 单`);
  console.log(`目标金额: ¥${targetAmount.toFixed(2)}`);
  
  // 收货人分布
  const receiverStats = {};
  allOrders.forEach(o => {
    const r = o.receiver || '无';
    receiverStats[r.substring(0, 30)] = (receiverStats[r.substring(0, 30)] || 0) + 1;
  });
  
  console.log('\n收货人分布:');
  Object.entries(receiverStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([k, v]) => console.log(`  ${k}: ${v}单`));
  
  // 保存结果
  const output = {
    scanDate: new Date().toISOString(),
    total: allOrders.length,
    targetCount: targetOrders.length,
    targetAmount: targetAmount.toFixed(2),
    allOrders: allOrders,
    targetOrders: targetOrders
  };
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n结果已保存: ${OUTPUT_FILE}`);
  
  await ctx.close();
}

main().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
