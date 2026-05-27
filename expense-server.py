#!/usr/bin/env python3
"""
报销明细管理后端服务
"""

import os
import json
import csv
import re
import shutil
from pathlib import Path
from datetime import datetime
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import pymupdf  # PyMuPDF

app = Flask(__name__)
CORS(app)

# 配置
CSV_PATH = Path.home() / '报销明细.csv'
INVOICES_DIR = Path.home() / 'invoices'
JD_INVOICES_DIR = Path.home() / 'projects' / 'jd-invoice' / 'invoices'
TB_INVOICES_DIR = Path.home() / 'projects' / 'taobao-invoice-helper' / 'downloads'
INVOICES_DB = INVOICES_DIR / 'invoices.json'

# 确保目录存在
INVOICES_DIR.mkdir(exist_ok=True)


def load_csv_data():
    """加载CSV数据"""
    data = []
    if not CSV_PATH.exists():
        return data
    
    with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            data.append({
                'platform': row.get('平台', ''),
                'orderId': row.get('订单号', ''),
                'date': row.get('日期', ''),
                'amount': row.get('金额', '0'),
                'shop': row.get('店铺', ''),
                'receiver': row.get('收货人', ''),
                'url': row.get('订单链接', '')
            })
    return data


def load_invoices_db():
    """加载发票数据库"""
    if INVOICES_DB.exists():
        with open(INVOICES_DB, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_invoices_db(data):
    """保存发票数据库"""
    with open(INVOICES_DB, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def scan_invoice_files():
    """扫描所有发票文件"""
    invoices = {}
    
    # 扫描京东发票
    if JD_INVOICES_DIR.exists():
        for f in JD_INVOICES_DIR.glob('*.pdf'):
            # 格式: 台州振鹏单向器有限公司-3500406017263276.pdf
            match = re.search(r'-(\d+)\.pdf$', f.name)
            if match:
                order_id = match.group(1)
                invoices[order_id] = {
                    'orderId': order_id,
                    'file': str(f),
                    'type': '电子发票',
                    'source': 'jd'
                }
    
    # 扫描淘宝发票
    if TB_INVOICES_DIR.exists():
        for f in TB_INVOICES_DIR.glob('*.pdf'):
            # 格式: 4796742132821956314_劲功旗舰店_6.09_no_invoice_2025-10-09.pdf
            match = re.match(r'^(\d+)_', f.name)
            if match:
                order_id = match.group(1)
                # 解析文件名中的信息
                parts = f.stem.split('_')
                amount = parts[2] if len(parts) > 2 else ''
                status = parts[3] if len(parts) > 3 else ''
                
                invoices[order_id] = {
                    'orderId': order_id,
                    'file': str(f),
                    'type': '电子发票',
                    'source': 'taobao',
                    'amount': amount,
                    'status': status
                }
    
    # 扫描本地发票目录
    if INVOICES_DIR.exists():
        for f in INVOICES_DIR.glob('*.pdf'):
            match = re.match(r'^(\d+)', f.name)
            if match:
                order_id = match.group(1)
                if order_id not in invoices:
                    invoices[order_id] = {
                        'orderId': order_id,
                        'file': str(f),
                        'source': 'manual'
                    }
    
    return invoices


def parse_invoice_pdf(pdf_path):
    """解析发票PDF，提取关键信息"""
    result = {
        'number': None,
        'type': None,
        'date': None,
        'amount': None
    }
    
    try:
        doc = pymupdf.open(pdf_path)
        text = ''
        for page in doc:
            text += page.get_text()
        doc.close()
        
        # 提取发票号码（常见格式：20位数字）
        number_match = re.search(r'发票号码[：:]\s*(\d{20})', text)
        if not number_match:
            number_match = re.search(r'号码[：:]\s*(\d{20})', text)
        if not number_match:
            # 尝试其他格式
            number_match = re.search(r'(\d{20})', text)
        if number_match:
            result['number'] = number_match.group(1)
        
        # 提取发票类型
        if '增值税电子专用发票' in text or '数电专票' in text:
            result['type'] = '数电专票'
        elif '增值税专用发票' in text:
            result['type'] = '专用纸质'
        elif '增值税电子普通发票' in text or '电子发票' in text:
            result['type'] = '电子发票'
        else:
            result['type'] = '普通发票'
        
        # 提取开票日期
        date_match = re.search(r'开票日期[：:]\s*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})', text)
        if date_match:
            result['date'] = f"{date_match.group(1)}-{date_match.group(2).zfill(2)}-{date_match.group(3).zfill(2)}"
        else:
            date_match = re.search(r'(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})日?', text)
            if date_match:
                result['date'] = f"{date_match.group(1)}-{date_match.group(2).zfill(2)}-{date_match.group(3).zfill(2)}"
        
        # 提取金额
        amount_match = re.search(r'[价合]计[：:]\s*[¥￥]?\s*([\d,]+\.?\d*)', text)
        if amount_match:
            result['amount'] = amount_match.group(1).replace(',', '')
        else:
            amount_match = re.search(r'[¥￥]\s*([\d,]+\.?\d*)', text)
            if amount_match:
                result['amount'] = amount_match.group(1).replace(',', '')
                
    except Exception as e:
        print(f"解析PDF失败: {e}")
    
    return result


# API 路由

@app.route('/api/expenses/csv', methods=['GET'])
def get_csv():
    """获取CSV数据"""
    data = load_csv_data()
    return jsonify(data)


@app.route('/api/expenses/invoices', methods=['GET'])
def get_invoices():
    """获取发票数据"""
    db = load_invoices_db()
    files = scan_invoice_files()
    
    # 合并数据库记录和扫描结果
    result = {}
    for order_id, info in files.items():
        result[order_id] = info
    for order_id, info in db.items():
        if order_id in result:
            result[order_id].update(info)
        else:
            result[order_id] = info
    
    return jsonify(result)


@app.route('/api/expenses/invoices', methods=['POST'])
def save_invoice():
    """保存发票信息"""
    data = request.json
    order_id = data.get('orderId')
    
    if not order_id:
        return jsonify({'error': '缺少订单号'}), 400
    
    db = load_invoices_db()
    db[order_id] = {
        'orderId': order_id,
        'type': data.get('type'),
        'number': data.get('number'),
        'date': data.get('date'),
        'file': data.get('file'),
        'updatedAt': datetime.now().isoformat()
    }
    
    save_invoices_db(db)
    return jsonify({'success': True, 'data': db[order_id]})


@app.route('/api/expenses/parse-invoice', methods=['POST'])
def parse_invoice():
    """解析上传的发票PDF"""
    if 'file' not in request.files:
        return jsonify({'error': '没有文件'}), 400
    
    file = request.files['file']
    order_id = request.form.get('orderId', '')
    
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400
    
    # 保存文件
    filename = f"{order_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}.pdf"
    filepath = INVOICES_DIR / filename
    file.save(filepath)
    
    # 解析发票
    result = parse_invoice_pdf(filepath)
    result['savedAs'] = filename
    
    return jsonify(result)


@app.route('/api/expenses/invoices/<order_id>/file', methods=['GET'])
def get_invoice_file(order_id):
    """获取发票文件"""
    db = load_invoices_db()
    files = scan_invoice_files()
    
    # 优先从数据库获取
    if order_id in db and db[order_id].get('file'):
        filepath = Path(db[order_id]['file'])
        if filepath.exists():
            return send_file(filepath, mimetype='application/pdf')
    
    # 从扫描结果获取
    if order_id in files and files[order_id].get('file'):
        filepath = Path(files[order_id]['file'])
        if filepath.exists():
            return send_file(filepath, mimetype='application/pdf')
    
    return jsonify({'error': '发票文件不存在'}), 404


@app.route('/', methods=['GET'])
def index():
    """返回HTML页面"""
    html_path = Path.home() / '报销明细管理.html'
    if html_path.exists():
        return send_file(html_path)
    return jsonify({'error': 'HTML文件不存在'}), 404


if __name__ == '__main__':
    print("报销明细管理服务启动中...")
    print(f"CSV路径: {CSV_PATH}")
    print(f"发票目录: {INVOICES_DIR}")
    print(f"京东发票: {JD_INVOICES_DIR}")
    print(f"淘宝发票: {TB_INVOICES_DIR}")
    app.run(host='0.0.0.0', port=5050, debug=False, threaded=True)
