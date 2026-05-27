import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import https from 'https'

const targetUrl = 'https://myivc.jd.com/fpzz/index.action'
const downloadDir = path.resolve('./invoices')

// 确保下载目录存在
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true })
}

async function downloadInvoices() {
  // 连接到 Windows Edge 的远程调试端口
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222',
    defaultViewport: null
  })
  
  console.log('✅ 已连接到 Edge 浏览器')
  
  // 获取现有页面
  const pages = await browser.pages()
  let page = pages.find(p => p.url().includes('jd.com')) || pages[0]
  
  if (!page) {
    page = await browser.newPage()
  }
  
  // 导航到发票管理页面
  await page.goto(targetUrl, { waitUntil: 'networkidle2' })
  console.log(`当前页面: ${page.url()}`)
  
  // 检查是否需要登录
  if (page.url().includes('passport.jd.com')) {
    console.log('⚠️ 需要登录！请在 Edge 浏览器中完成登录（扫码或账号密码）')
    console.log('等待登录完成...')
    
    // 等待登录完成（最多等待 120 秒）
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const currentUrl = page.url()
      if (currentUrl === targetUrl || currentUrl.includes('myivc.jd.com')) {
        console.log('✅ 登录成功！')
        break
      }
      if (i === 59) {
        console.log('❌ 登录超时')
        await browser.disconnect()
        return
      }
    }
  }
  
  // 等待发票列表加载
  await page.waitForSelector('.order-tb', { timeout: 10000 })
  console.log('✅ 发票列表已加载')
  
  // 获取发票总数
  const pageText = await page.evaluate(() => {
    const curr = document.querySelector('.ui-page-curr')
    return curr ? curr.innerText : '1'
  })
  console.log(`当前页码: ${pageText}`)
  
  let downloaded = 0
  let processed = 0
  
  // 处理当前页的发票
  async function processCurrentPage() {
    const rows = await page.$$('.order-tb tbody')
    
    for (const row of rows) {
      processed++
      
      // 获取订单号
      const orderNum = await row.evaluate(el => {
        const numEl = el.querySelector('.tr-th .number')
        if (numEl) {
          const match = numEl.innerText.match(/(\d+)/)
          return match ? match[0] : null
        }
        return null
      })
      
      if (!orderNum) continue
      
      // 获取状态
      const status = await row.evaluate(el => {
        const td = el.querySelector('td:nth-child(3)') || el.querySelector('td:nth-child(2)')
        return td ? td.innerText.trim() : ''
      })
      
      console.log(`[${processed}] 订单 ${orderNum} - 状态: ${status}`)
      
      if (status.includes('已开票')) {
        // 查找发票详情链接
        const links = await row.evaluate(el => {
          const hash = {}
          Array.from(el.querySelectorAll('.operate a')).forEach(a => {
            hash[a.innerText] = a.href
          })
          return hash
        })
        
        if (links['发票详情']) {
          console.log(`  → 下载发票...`)
          
          try {
            // 打开发票详情页
            const detailPage = await browser.newPage()
            await detailPage.goto(links['发票详情'], { waitUntil: 'networkidle2' })
            
            // 获取下载链接
            await detailPage.waitForSelector('.download-trigger', { timeout: 5000 })
            const downloadUrl = await detailPage.$eval('.download-trigger', el => el.href)
            
            // 获取发票抬头作为文件名
            const invoiceTitle = await detailPage.evaluate(() => {
              const labelSpan = Array.from(document.querySelectorAll('td.label span'))
                .find(span => span.textContent.includes('发票抬头'))
              if (labelSpan) {
                const valueTd = labelSpan.parentNode.nextElementSibling
                return valueTd ? valueTd.textContent.trim() : 'unknown'
              }
              return 'unknown'
            })
            
            const filename = `${invoiceTitle}-${orderNum}.pdf`
            const filepath = path.join(downloadDir, filename)
            
            // 下载发票
            const file = fs.createWriteStream(filepath)
            https.get(downloadUrl, response => {
              response.pipe(file)
              file.on('finish', () => {
                console.log(`  ✅ 已保存: ${filename}`)
                file.close()
              })
            }).on('error', err => {
              console.log(`  ❌ 下载失败: ${err.message}`)
            })
            
            await detailPage.close()
            downloaded++
            
            // 稍等一下避免请求过快
            await new Promise(r => setTimeout(r, 500))
            
          } catch (e) {
            console.log(`  ❌ 处理失败: ${e.message}`)
          }
        }
      } else if (status.includes('未开票')) {
        console.log(`  ⚠️ 未开票，跳过`)
      }
    }
  }
  
  // 处理所有页面
  let pageNum = 1
  const maxPages = 20 // 安全限制
  
  while (true) {
    await processCurrentPage()
    
    // 检查是否有下一页
    const nextBtn = await page.$('.ui-pager-next:not(.ui-pager-disabled)')
    if (!nextBtn || pageNum >= maxPages) break
    
    pageNum++
    console.log(`\n→ 跳转到第 ${pageNum} 页...`)
    
    // 点击下一页
    await nextBtn.click()
    await new Promise(r => setTimeout(r, 2000))
    
    // 等待新内容加载
    try {
      await page.waitForSelector('.order-tb tbody', { timeout: 10000 })
    } catch (e) {
      console.log('等待页面加载超时，停止')
      break
    }
  }
  
  console.log(`\n========== 完成 ==========`)
  console.log(`处理: ${processed} 单`)
  console.log(`下载: ${downloaded} 个发票`)
  console.log(`保存目录: ${downloadDir}`)
  
  // 断开连接（不关闭浏览器）
  await browser.disconnect()
}

downloadInvoices().catch(err => {
  console.error('错误:', err)
  process.exit(1)
})