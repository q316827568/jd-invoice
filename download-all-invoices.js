const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const https = require('https');

const downloadDir = path.resolve('./invoices-all');
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

async function downloadAllInvoices() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222',
    defaultViewport: null
  });
  
  console.log('✅ 已连接到浏览器');
  
  const pages = await browser.pages();
  let page = pages.find(p => p.url().includes('jd.com')) || pages[0];
  
  // 确保在订单列表页
  await page.goto('https://order.jd.com/center/list.action', { waitUntil: 'networkidle2' });
  
  // 滚动加载所有订单
  console.log('正在加载所有订单...');
  let lastCount = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1500));
    
    const currentCount = await page.evaluate(() => {
      return document.querySelectorAll('.order-tb').length;
    });
    
    if (currentCount === lastCount) break;
    lastCount = currentCount;
    console.log(`  已加载 ${currentCount} 个订单`);
  }
  
  // 提取所有"查看发票"链接
  const invoiceLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    const results = [];
    for (const link of links) {
      if (link.innerText?.includes('查看发票') && link.href?.includes('ivcLand.action')) {
        // 从 URL 提取订单号
        const match = link.href.match(/orderId=(\d+)/);
        if (match) {
          results.push({
            orderId: match[1],
            url: link.href
          });
        }
      }
    }
    return results;
  });
  
  console.log(`\n找到 ${invoiceLinks.length} 个发票链接`);
  
  let downloaded = 0;
  let skipped = 0;
  
  for (const item of invoiceLinks) {
    const { orderId, url } = item;
    
    // 检查是否已下载
    const existingFile = fs.readdirSync(downloadDir).find(f => f.includes(orderId));
    if (existingFile) {
      console.log(`[${orderId}] 已存在，跳过`);
      skipped++;
      continue;
    }
    
    console.log(`\n处理订单 ${orderId}...`);
    
    try {
      // 打开发票页面
      const invoicePage = await browser.newPage();
      await invoicePage.goto(url, { waitUntil: 'networkidle2' });
      
      // 等待页面加载
      await new Promise(r => setTimeout(r, 1000));
      
      // 查找下载按钮
      const downloadUrl = await invoicePage.evaluate(() => {
        // 标准选择器
        const downloadBtn = document.querySelector('.download-trigger') || 
                           document.querySelector('a[href$=".pdf"]');
        if (downloadBtn) return downloadBtn.href;
        
        // 查找包含"下载"文本的链接
        const links = document.querySelectorAll('a');
        for (const link of links) {
          if (link.innerText?.includes('下载')) {
            return link.href;
          }
        }
        return null;
      });
      
      if (downloadUrl) {
        // 获取发票抬头
        const invoiceTitle = await invoicePage.evaluate(() => {
          const labelSpan = Array.from(document.querySelectorAll('td.label span, .label span'))
            .find(span => span.textContent?.includes('发票抬头'));
          if (labelSpan) {
            const valueTd = labelSpan.parentNode?.nextElementSibling;
            return valueTd ? valueTd.textContent?.trim() : 'unknown';
          }
          return 'unknown';
        });
        
        const filename = `${invoiceTitle}-${orderId}.pdf`;
        const filepath = path.join(downloadDir, filename);
        
        // 下载
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(filepath);
          https.get(downloadUrl, response => {
            response.pipe(file);
            file.on('finish', () => {
              file.close();
              console.log(`  ✅ 已下载: ${filename}`);
              downloaded++;
              resolve();
            });
          }).on('error', err => {
            fs.unlinkSync(filepath);
            console.log(`  ❌ 下载失败: ${err.message}`);
            resolve();
          });
        });
        
      } else {
        // 检查是否是未开票
        const pageText = await invoicePage.evaluate(() => document.body.innerText);
        if (pageText.includes('未开票') || pageText.includes('申请开票')) {
          console.log(`  ⚠️ 未开票`);
        } else {
          console.log(`  ❌ 未找到下载按钮`);
        }
      }
      
      await invoicePage.close();
      
    } catch (e) {
      console.log(`  ❌ 处理失败: ${e.message}`);
    }
  }
  
  console.log(`\n========== 完成 ==========`);
  console.log(`处理: ${invoiceLinks.length} 个订单`);
  console.log(`下载: ${downloaded} 个发票`);
  console.log(`跳过: ${skipped} 个已存在`);
  console.log(`保存目录: ${downloadDir}`);
  
  await browser.disconnect();
}

downloadAllInvoices().catch(console.error);
