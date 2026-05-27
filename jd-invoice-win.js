// 京东发票下载脚本 - Windows 版
// 使用方法：在 Windows PowerShell 中运行 node jd-invoice-win.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function downloadJDInvoices() {
  // 读取订单数据
  const ordersData = JSON.parse(fs.readFileSync('jd-orders.json', 'utf-8'));
  const orders = ordersData.allOrders;
  
  console.log(`共 ${orders.length} 个订单待处理`);
  
  // 创建下载目录
  const downloadDir = path.join(__dirname, 'invoices');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  
  // 启动浏览器
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 300
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  // 设置下载路径
  await context.setDefaultTimeout(30000);
  
  const page = await context.newPage();
  
  // 先打开京东登录页
  console.log('\n请在浏览器中登录京东账号...');
  await page.goto('https://passport.jd.com/new/login.aspx', { waitUntil: 'networkidle' });
  
  // 等待登录成功（手动登录后自动跳转）
  console.log('等待登录...');
  
  // 检测登录成功的标志
  let loggedIn = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    try {
      // 检查是否有用户名显示
      const userInfo = await page.$('.nickname, .user-name, [class*="userName"]');
      if (userInfo) {
        loggedIn = true;
        console.log('登录成功！');
        break;
      }
      // 或者尝试访问订单页面
      await page.goto('https://order.jd.com/center/list.action', { waitUntil: 'networkidle' });
      const orderList = await page.$('.order-tb, .order-list');
      if (orderList) {
        loggedIn = true;
        console.log('登录成功！');
        break;
      }
    } catch (e) {
      // 继续等待
    }
  }
  
  if (!loggedIn) {
    console.log('登录超时，请重新运行脚本');
    await browser.close();
    return;
  }
  
  let processed = 0;
  let downloaded = 0;
  const results = [];
  
  for (const order of orders) {
    processed++;
    const orderId = order.orderId;
    console.log(`\n[${processed}/${orders.length}] 处理订单 ${orderId}`);
    
    try {
      // 访问发票管理页面
      await page.goto('https://order.jd.com/center/invoice.action', { waitUntil: 'networkidle' });
      
      // 查找订单对应的发票
      const invoiceRow = await page.$(`tr:has-text("${orderId}"), div:has-text("${orderId}")`);
      
      if (!invoiceRow) {
        console.log('未找到发票记录');
        results.push({ orderId, status: 'not_found' });
        continue;
      }
      
      // 查找下载按钮
      const downloadBtn = await page.$('a:has-text("下载"), button:has-text("下载"), a[href$=".pdf"]');
      
      if (downloadBtn) {
        // 点击下载
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
          downloadBtn.click()
        ]);
        
        if (download) {
          const filename = `JD_${orderId}.pdf`;
          const filepath = path.join(downloadDir, filename);
          await download.saveAs(filepath);
          console.log(`✓ 下载成功: ${filename}`);
          downloaded++;
          results.push({ orderId, status: 'downloaded', file: filename });
        } else {
          console.log('下载失败');
          results.push({ orderId, status: 'download_failed' });
        }
      } else {
        console.log('无下载按钮');
        results.push({ orderId, status: 'no_download_btn' });
      }
      
      await page.waitForTimeout(500);
      
    } catch (e) {
      console.log(`处理失败: ${e.message}`);
      results.push({ orderId, status: 'error', error: e.message });
    }
  }
  
  // 保存结果
  fs.writeFileSync('invoice-download-results.json', JSON.stringify(results, null, 2));
  
  console.log(`\n========== 完成 ==========`);
  console.log(`处理: ${processed} 单`);
  console.log(`下载: ${downloaded} 个发票`);
  console.log(`结果已保存到: invoice-download-results.json`);
  
  await browser.close();
}

downloadJDInvoices().catch(console.error);
