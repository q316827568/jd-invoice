const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function downloadJDInvoices() {
  // 读取订单数据
  const ordersData = JSON.parse(fs.readFileSync('jd-orders.json', 'utf-8'));
  const orders = ordersData.allOrders;
  
  console.log(`共 ${orders.length} 个订单待处理`);
  
  // 启动浏览器 - 使用 Windows Edge
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500,
    executablePath: '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--start-maximized']
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  // 创建下载目录
  const downloadDir = path.join(__dirname, 'invoices');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  
  // 监听下载事件
  const downloadedFiles = [];
  context.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('pdf') || url.includes('invoice')) {
      console.log(`检测到发票响应: ${url}`);
    }
  });
  
  // 先打开京东登录页，等待用户登录
  console.log('\n请在浏览器中登录京东账号...');
  await page.goto('https://passport.jd.com/new/login.aspx', { waitUntil: 'networkidle' });
  
  // 等待登录成功（检测订单页面元素）
  await page.goto('https://order.jd.com/center/list.action', { waitUntil: 'networkidle' });
  
  // 等待订单列表加载
  try {
    await page.waitForSelector('.order-tb', { timeout: 30000 });
    console.log('登录成功，开始处理订单...');
  } catch (e) {
    console.log('等待登录超时，请检查是否已登录');
    await browser.close();
    return;
  }
  
  let processed = 0;
  let downloaded = 0;
  
  for (const order of orders) {
    processed++;
    const orderId = order.orderId;
    console.log(`\n[${processed}/${orders.length}] 处理订单 ${orderId}`);
    
    try {
      // 打开订单详情页
      const detailUrl = order.orderUrl;
      await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 30000 });
      
      // 查找发票按钮或链接
      // 尝试多种选择器
      const invoiceSelectors = [
        'a:has-text("发票")',
        'button:has-text("发票")',
        '.invoice-btn',
        '[data-action="invoice"]',
        'a[href*="invoice"]'
      ];
      
      let invoiceBtn = null;
      for (const selector of invoiceSelectors) {
        try {
          invoiceBtn = await page.$(selector);
          if (invoiceBtn) {
            console.log(`找到发票按钮: ${selector}`);
            break;
          }
        } catch (e) {
          // 继续尝试下一个选择器
        }
      }
      
      if (!invoiceBtn) {
        console.log('未找到发票按钮，跳过');
        continue;
      }
      
      // 点击发票按钮
      await invoiceBtn.click();
      await page.waitForTimeout(2000);
      
      // 查找下载按钮
      const downloadSelectors = [
        'a:has-text("下载")',
        'button:has-text("下载")',
        'a[href$=".pdf"]',
        '.download-btn'
      ];
      
      for (const selector of downloadSelectors) {
        try {
          const downloadBtn = await page.$(selector);
          if (downloadBtn) {
            // 设置下载路径
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
              downloadBtn.click()
            ]);
            
            if (download) {
              const filename = `JD_${orderId}_${Date.now()}.pdf`;
              const filepath = path.join(downloadDir, filename);
              await download.saveAs(filepath);
              console.log(`✓ 下载成功: ${filename}`);
              downloaded++;
              break;
            }
          }
        } catch (e) {
          // 继续尝试
        }
      }
      
      await page.waitForTimeout(1000);
      
    } catch (e) {
      console.log(`处理失败: ${e.message}`);
    }
  }
  
  console.log(`\n========== 完成 ==========`);
  console.log(`处理: ${processed} 单`);
  console.log(`下载: ${downloaded} 个发票`);
  
  await browser.close();
}

downloadJDInvoices().catch(console.error);
