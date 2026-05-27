const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const os = require('os');

function expandUser(p) {
  return p.replace('~', os.homedir());
}

const TAOBAO_PROGRESS = expandUser('~/projects/taobao-invoice-helper/invoice-action-progress.json');
const TAOBAO_PRODUCTS = expandUser('~/projects/taobao-invoice-helper/product-names.json');
const TAOBAO_ADDRESSES = expandUser('~/projects/taobao-invoice-helper/receiver-addresses.json');
const JD_ORDERS = expandUser('~/projects/jd-invoice/jd-orders-full.json');
const JD_ORDERS_FALLBACK = expandUser('~/projects/jd-invoice/jd-orders.json');
const JD_INVOICES_DIR = expandUser('~/projects/jd-invoice/invoices');
const TAOBAO_DOWNLOADS = expandUser('~/projects/taobao-invoice-helper/downloads');
const OUTPUT_FILE = expandUser('~/报销明细.xlsx');

// 目标收货人关键词
const TARGET_KEYWORDS = ['台州振鹏', '振鹏单向器', '台州振鹏单向器有限公司'];

// 扫描目录获取发票文件映射 (orderId -> filePath)
function scanInvoiceDir(dir, isJd = false) {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.pdf')) {
      let orderId;
      if (isJd) {
        // 京东格式: 公司名-订单号.pdf
        const match = file.match(/-(\d+)\.pdf$/);
        orderId = match ? match[1] : file.split('-').pop().replace('.pdf', '');
      } else {
        // 淘宝格式: 订单号_店铺_金额_no_invoice_日期.pdf
        orderId = file.split('_')[0];
      }
      map.set(orderId, path.join(dir, file));
    }
  }
  return map;
}

// 从发票文件名提取商品/店铺信息
function extractInfoFromFilename(filename) {
  // 格式: orderId_shopName_amount_no_invoice_date.pdf
  const base = path.basename(filename, '.pdf');
  const parts = base.split('_');
  if (parts.length >= 2) {
    // 去掉 orderId, amount, no, invoice, date
    // 剩下的就是 shopName
    return parts.slice(1, -4).join('_') || parts[1] || '';
  }
  return '';
}

async function main() {
  console.log('生成报销明细...\n');
  
  const allOrders = [];
  const taobaoInvoiceMap = scanInvoiceDir(TAOBAO_DOWNLOADS, false);
  const jdInvoiceMap = scanInvoiceDir(JD_INVOICES_DIR, true);
  
  // 加载商品名称映射
  let productNames = {};
  if (fs.existsSync(TAOBAO_PRODUCTS)) {
    productNames = JSON.parse(fs.readFileSync(TAOBAO_PRODUCTS, 'utf-8'));
  }
  
  // 加载收货地址映射
  let receiverAddresses = {};
  if (fs.existsSync(TAOBAO_ADDRESSES)) {
    receiverAddresses = JSON.parse(fs.readFileSync(TAOBAO_ADDRESSES, 'utf-8'));
  }
  
  console.log(`淘宝发票: ${taobaoInvoiceMap.size} 张`);
  console.log(`京东发票: ${jdInvoiceMap.size} 张`);
  console.log(`商品名称: ${Object.keys(productNames).length} 单`);
  console.log(`收货地址: ${Object.keys(receiverAddresses).length} 单`);
  
  // 读取淘宝订单
  let taobaoSkipped = 0;
  if (fs.existsSync(TAOBAO_PROGRESS)) {
    const taobaoData = JSON.parse(fs.readFileSync(TAOBAO_PROGRESS, 'utf-8'));
    for (const o of taobaoData.mappings || []) {
      // 检查收货地址是否为目标地址
      const addrInfo = receiverAddresses[o.bizOrderId];
      if (addrInfo) {
        const isTarget = TARGET_KEYWORDS.some(k => addrInfo.address.includes(k));
        if (!isTarget) {
          taobaoSkipped++;
          continue;
        }
      }
      // 没有地址信息的订单默认保留（可能快照不全）
      
      const invoicePath = taobaoInvoiceMap.get(o.bizOrderId) || '';
      const shopInfo = invoicePath ? extractInfoFromFilename(invoicePath) : '';
      const productName = productNames[o.bizOrderId] || '';
      const receiver = addrInfo ? addrInfo.name || '' : '台州振鹏单向器有限公司';
      allOrders.push({
        '平台': o.platform === 'taobao' ? '淘宝' : '天猫',
        '订单号': o.bizOrderId,
        '日期': o.orderDate,
        '金额': parseFloat(o.amount || 0),
        '店铺': o.shopName || shopInfo || '',
        '商品名称': productName,
        '收货人': receiver,
        '订单链接': o.url,
        '发票路径': invoicePath
      });
    }
    console.log(`淘宝订单: ${taobaoData.mappings?.length - taobaoSkipped || 0} 单 (跳过非目标地址 ${taobaoSkipped} 单)`);
  }
  
  // 读取京东订单
  let jdOrdersFile = JD_ORDERS;
  if (!fs.existsSync(JD_ORDERS) && fs.existsSync(JD_ORDERS_FALLBACK)) {
    jdOrdersFile = JD_ORDERS_FALLBACK;
  }
  
  if (fs.existsSync(jdOrdersFile)) {
    const jdData = JSON.parse(fs.readFileSync(jdOrdersFile, 'utf-8'));
    const jdOrders = jdData.targetOrders || jdData.allOrders || [];
    let jdCount = 0;
    let jdSkipped = 0;
    
    for (const o of jdOrders) {
      // 筛选目标收货人
      const receiver = o.receiver || '';
      const isTarget = o.isTarget !== undefined 
        ? o.isTarget 
        : TARGET_KEYWORDS.some(k => receiver.includes(k));
      
      if (!isTarget) {
        jdSkipped++;
        continue;
      }
      
      const invoicePath = jdInvoiceMap.get(String(o.orderId)) || '';
      allOrders.push({
        '平台': '京东',
        '订单号': o.orderId,
        '日期': o.orderDate,
        '金额': parseFloat(o.amount || 0),
        '店铺': o.shopName || '',
        '商品名称': o.goodsName || '',
        '收货人': receiver || '台州振鹏单向器有限公司',
        '订单链接': o.orderUrl,
        '发票路径': invoicePath
      });
      jdCount++;
    }
    console.log(`京东订单: ${jdCount} 单 (跳过非目标收货人 ${jdSkipped} 单)`);
  }
  
  // 按日期排序
  allOrders.sort((a, b) => (b['日期'] || '').localeCompare(a['日期'] || ''));
  
  // 创建 Excel
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('报销明细');
  
  // 设置列
  worksheet.columns = [
    { header: '平台', key: '平台', width: 8 },
    { header: '订单号', key: '订单号', width: 22 },
    { header: '日期', key: '日期', width: 12 },
    { header: '金额', key: '金额', width: 10 },
    { header: '店铺', key: '店铺', width: 25 },
    { header: '商品名称', key: '商品名称', width: 35 },
    { header: '收货人', key: '收货人', width: 20 },
    { header: '订单链接', key: '订单链接', width: 40 },
    { header: '发票', key: '发票路径', width: 15 }
  ];
  
  // 设置标题行样式
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  headerRow.alignment = { horizontal: 'center' };
  
  // 添加数据
  worksheet.addRows(allOrders);
  
  // 为发票路径添加超链接，无发票的标注"无"
  let invoiceCount = 0;
  for (let i = 2; i <= worksheet.rowCount; i++) {
    const row = worksheet.getRow(i);
    const cell = row.getCell(9); // 发票列
    const invoicePath = cell.value;
    
    if (invoicePath && fs.existsSync(invoicePath)) {
      invoiceCount++;
      // 转换为 Windows 可访问的路径: /home/xxx -> \\wsl.localhost\Ubuntu\home\xxx
      const winPath = '\\\\wsl.localhost\\Ubuntu' + invoicePath.replace(/\//g, '\\');
      cell.value = {
        text: '📄 查看发票',
        hyperlink: winPath,
        tooltip: winPath
      };
      cell.font = { color: { argb: 'FF0066CC' }, underline: true };
      cell.alignment = { horizontal: 'center' };
    } else {
      cell.value = '无';
      cell.font = { color: { argb: 'FF999999' } };
      cell.alignment = { horizontal: 'center' };
    }
    
    // 金额格式
    const amountCell = row.getCell(4);
    amountCell.numFmt = '¥#,##0.00';
  }
  
  // 添加汇总行
  const totalAmount = allOrders.reduce((sum, o) => sum + (o['金额'] || 0), 0);
  const summaryRow = worksheet.addRow({
    '平台': '合计',
    '订单号': `${allOrders.length} 单`,
    '金额': totalAmount,
    '发票路径': `${invoiceCount} 张`
  });
  summaryRow.font = { bold: true, size: 11 };
  summaryRow.getCell(4).numFmt = '¥#,##0.00';
  
  // 保存
  await workbook.xlsx.writeFile(OUTPUT_FILE);
  
  // 也复制到 Windows 桌面
  const desktop = '/mnt/c/Users/7/Desktop/报销明细.xlsx';
  try {
    fs.copyFileSync(OUTPUT_FILE, desktop);
    console.log(`桌面副本: ${desktop}`);
  } catch (e) {
    // 忽略
  }
  
  console.log(`\n已生成: ${OUTPUT_FILE}`);
  console.log(`总订单: ${allOrders.length} 单`);
  console.log(`总金额: ¥${totalAmount.toFixed(2)}`);
  console.log(`有发票: ${invoiceCount} 张`);
}

main().catch(console.error);
