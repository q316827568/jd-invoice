#!/usr/bin/env python3
"""
从京东发票管理页面重新下载发票
前置：Windows Chrome 运行中，端口 9222，已登录京东
"""

import asyncio
import json
import re
import os
import time
from pathlib import Path
from datetime import datetime

CDP_URL = "http://127.0.0.1:9222"
INVOICE_URL = "https://invoice.jd.com/"
INVOICES_DIR = Path.home() / "projects" / "jd-invoice" / "invoices"

def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


async def main():
    log("==== 重新下载京东发票 ====")
    
    # 读取需要重新下载的订单
    orders_file = Path(__file__).parent / "redownload_orders.json"
    if not orders_file.exists():
        log("无 redownload_orders.json")
        return
    
    with open(orders_file) as f:
        orders = json.load(f)
    
    log(f"待下载: {len(orders)} 个订单的发票")
    
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    
    sp = StdioServerParameters(
        command="npx",
        args=["-y", "chrome-devtools-mcp@latest", "--browser-url", CDP_URL]
    )
    
    async with stdio_client(sp) as (r, w):
        async with ClientSession(r, w) as session:
            await session.initialize()
            
            # 导航到京东发票页面
            log("→ 导航到京东发票页面...")
            await session.call_tool("navigate_page", {"url": INVOICE_URL})
            await asyncio.sleep(3)
            
            downloaded = 0
            for i, (order_id, info) in enumerate(orders.items(), 1):
                log(f"[{i}/{len(orders)}] {order_id} - {info.get('店铺', '')}")
                
                try:
                    # 搜索订单号
                    snap = await session.call_tool("take_snapshot", {})
                    snap_text = snap.content[0].text if snap.content else ""
                    
                    # 找搜索框
                    search_m = re.search(r'uid=(\d+_\d+)\s+.*搜索', snap_text)
                    if not search_m:
                        log("  未找到搜索框")
                        continue
                    
                    await session.call_tool("fill", {"uid": search_m.group(1), "value": order_id})
                    await session.call_tool("press_key", {"key": "Enter"})
                    await asyncio.sleep(2)
                    
                    # 找下载按钮
                    snap = await session.call_tool("take_snapshot", {})
                    snap_text = snap.content[0].text if snap.content else ""
                    
                    # 找下载发票链接
                    dl_m = re.search(r'uid=(\d+_\d+).*下载', snap_text)
                    if dl_m:
                        await session.call_tool("click", {"uid": dl_m.group(1)})
                        await asyncio.sleep(3)
                        log(f"  ✓ 已点击下载")
                        downloaded += 1
                        
                        # 删除旧的无效文件
                        old_file = INVOICES_DIR / f"台州振鹏单向器有限公司-{order_id}.pdf"
                        if old_file.exists():
                            os.remove(old_file)
                            log(f"  已删除旧文件")
                    else:
                        log(f"  ✗ 未找到下载按钮")
                        
                except Exception as e:
                    log(f"  错误: {e}")
                
                await asyncio.sleep(1)
    
    log(f"==== 完成，下载 {downloaded}/{len(orders)} 个 ====")


if __name__ == "__main__":
    asyncio.run(main())
